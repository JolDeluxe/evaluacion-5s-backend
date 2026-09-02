import type { PrismaTransaction } from '../../db';
import { EstadoAsignacionAuditoria, RolUsuario } from '../../generated/prisma/enums';
import { construirDetalleAdminPeriodo } from '../../utils/periodos';
import { areaEsAuditableEnPeriodo } from '../areas/servicio_vigencia_area';

export const puedeUsuarioAuditar = (usuario: { activo: boolean; rol: RolUsuario }) => (
  usuario.activo && (usuario.rol === RolUsuario.AUDITOR || usuario.rol === RolUsuario.ADMINISTRADOR)
);

export const clasificarAsignacionParaReasignacion = (
  objetivo: Parameters<typeof construirDetalleAdminPeriodo>[0],
  asignacion: { estado: EstadoAsignacionAuditoria; completadoEn: Date | null; reabiertaHasta: Date | null },
) => {
  const detalle = construirDetalleAdminPeriodo(objetivo, new Date(), asignacion.reabiertaHasta);
  if (detalle.realizada || Boolean(asignacion.completadoEn) || asignacion.estado === EstadoAsignacionAuditoria.COMPLETADA) {
    return { categoria: 'COMPLETADA' as const, detalle };
  }
  if ((asignacion.estado === EstadoAsignacionAuditoria.VENCIDA || detalle.situacion === 'NO_REALIZADA') && !detalle.reabierta) {
    return { categoria: 'VENCIDA' as const, detalle };
  }
  return { categoria: 'REASIGNABLE' as const, detalle };
};

export const obtenerImpactoAuditorNoEjecutable = async (tx: PrismaTransaction, usuarioId: number) => {
  const asignaciones = await tx.asignacionAuditoria.findMany({
    where: { auditorId: usuarioId, estado: { not: EstadoAsignacionAuditoria.CANCELADA } },
    include: { objetivoAuditoria: { include: { envioResultado: true, enviosAuditoria: true } } },
  });
  const impacto = { completadas: 0, vencidas: 0, reasignables: 0 };
  for (const asignacion of asignaciones) {
    const { categoria } = clasificarAsignacionParaReasignacion(asignacion.objetivoAuditoria, asignacion);
    if (categoria === 'COMPLETADA') impacto.completadas += 1;
    else if (categoria === 'VENCIDA') impacto.vencidas += 1;
    else impacto.reasignables += 1;
  }
  return impacto;
};

export const liberarAsignacionesDeAuditorNoEjecutable = async (
  tx: PrismaTransaction,
  usuarioId: number,
  motivo: 'AUDITOR_INACTIVO' | 'AUDITOR_SIN_ROL_EJECUTABLE' | 'AUDITOR_EN_SU_PROPIA_AREA',
  areaId?: number,
) => {
  const asignaciones = await tx.asignacionAuditoria.findMany({
    where: {
      auditorId: usuarioId,
      estado: { not: EstadoAsignacionAuditoria.CANCELADA },
      ...(areaId ? { objetivoAuditoria: { areaId } } : {}),
    },
    include: { objetivoAuditoria: { include: { envioResultado: true, enviosAuditoria: true } } },
  });
  let liberadas = 0;
  const mensualesAfectadas = new Set<number>();
  for (const asignacion of asignaciones) {
    if (clasificarAsignacionParaReasignacion(asignacion.objetivoAuditoria, asignacion).categoria !== 'REASIGNABLE') continue;
    await tx.asignacionAuditoria.update({
      where: { id: asignacion.id },
      data: {
        estado: EstadoAsignacionAuditoria.CANCELADA,
        canceladoEn: new Date(),
        motivoCancelacion: motivo,
        asignacionMensualId: null,
      },
    });
    await tx.enlaceInvitado.updateMany({
      where: { asignacionAuditoriaId: asignacion.id, revocadoEn: null },
      data: { revocadoEn: new Date() },
    });
    if (asignacion.asignacionMensualId) mensualesAfectadas.add(asignacion.asignacionMensualId);
    liberadas += 1;
  }

  // La decisión mensual deja de existir cuando su auditor ya no es válido. El auditor
  // histórico permanece en cada AsignacionAuditoria protegida.
  if (mensualesAfectadas.size) {
    await tx.asignacionAuditoria.updateMany({
      where: {
        asignacionMensualId: { in: [...mensualesAfectadas] },
      },
      data: { asignacionMensualId: null },
    });
    await tx.asignacionMensual.deleteMany({
      where: { id: { in: [...mensualesAfectadas] }, auditorId: usuarioId },
    });
  }
  return { liberadas };
};

export const obtenerAuditorAnterior = <T extends { estado: EstadoAsignacionAuditoria; actualizadoEn: Date }>(asignaciones: T[]) => (
  asignaciones
    .filter((asignacion) => asignacion.estado === EstadoAsignacionAuditoria.CANCELADA)
    .sort((a, b) => b.actualizadoEn.getTime() - a.actualizadoEn.getTime())[0] ?? null
);

export const obtenerPendientesGlobalesDeAsignacion = async (tx: PrismaTransaction) => {
  const ahora = new Date();
  const anioActual = ahora.getFullYear();
  const mesActual = ahora.getMonth() + 1;
  const objetivos = await tx.objetivoAuditoria.findMany({
    where: {
      canceladoEn: null,
      OR: [{ anio: { lt: anioActual } }, { anio: anioActual, mes: { lte: mesActual } }],
    },
    include: {
      area: { select: { id: true, codigo: true, nombre: true, tipo: true, activo: true, auditableDesde: true, auditableHasta: true } },
      envioResultado: true,
      enviosAuditoria: true,
      asignacionesAuditoria: {
        include: { auditor: { select: { id: true, nombre: true, nombreUsuario: true, activo: true, rol: true } } },
        orderBy: { actualizadoEn: 'desc' },
      },
    },
    orderBy: [{ anio: 'asc' }, { mes: 'asc' }, { periodo: 'asc' }, { area: { nombre: 'asc' } }],
  });

  return objetivos.flatMap((objetivo) => {
    if (!areaEsAuditableEnPeriodo(objetivo.area, objetivo.anio, objetivo.mes, objetivo.terminaEn.getDate())) return [];
    const asignacion = objetivo.asignacionesAuditoria.find((actual) => actual.estado !== EstadoAsignacionAuditoria.CANCELADA) ?? null;
    const clasificacion = asignacion
      ? clasificarAsignacionParaReasignacion(objetivo, asignacion)
      : (() => {
        const detalle = construirDetalleAdminPeriodo(objetivo, ahora, null);
        if (detalle.realizada) return { categoria: 'COMPLETADA' as const, detalle };
        if (detalle.situacion === 'NO_REALIZADA') return { categoria: 'VENCIDA' as const, detalle };
        return { categoria: 'REASIGNABLE' as const, detalle };
      })();
    if (clasificacion.categoria !== 'REASIGNABLE') return [];
    if (asignacion?.auditor && puedeUsuarioAuditar(asignacion.auditor)) return [];
    const anterior = asignacion ?? obtenerAuditorAnterior(objetivo.asignacionesAuditoria);
    return [{
      objetivoAuditoriaId: objetivo.id,
      area: { id: objetivo.area.id, codigo: objetivo.area.codigo, nombre: objetivo.area.nombre, tipo: objetivo.area.tipo },
      anio: objetivo.anio,
      mes: objetivo.mes,
      periodo: objetivo.periodo,
      situacion: clasificacion.detalle.situacion,
      cierreGracia: clasificacion.detalle.cierreGracia,
      reabiertaHasta: asignacion?.reabiertaHasta ?? null,
      auditorAnterior: anterior?.auditor ? { id: anterior.auditor.id, nombre: anterior.auditor.nombre, nombreUsuario: anterior.auditor.nombreUsuario } : null,
      motivo: asignacion?.auditor && !asignacion.auditor.activo
        ? 'Auditor anterior inactivo'
        : asignacion?.auditor && !puedeUsuarioAuditar(asignacion.auditor)
          ? 'Auditor anterior ya no puede auditar'
          : anterior?.motivoCancelacion === 'AUDITOR_INACTIVO'
            ? 'Auditor anterior inactivo'
            : anterior?.motivoCancelacion === 'AUDITOR_SIN_ROL_EJECUTABLE'
              ? 'Auditor anterior ya no puede auditar'
              : 'Sin auditor asignado',
    }];
  });
};
