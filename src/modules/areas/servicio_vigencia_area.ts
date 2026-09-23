import type { PrismaTransaction } from '../../db';
import { EstadoAsignacionAuditoria } from '../../generated/prisma/enums';

const serialFechaPeriodo = (anio: number, mes: number, dia: number) => anio * 10000 + mes * 100 + dia;
const serialFechaUtc = (fecha: Date) => (
  fecha.getUTCFullYear() * 10000 + (fecha.getUTCMonth() + 1) * 100 + fecha.getUTCDate()
);

const serialFechaEfectivaHasta = (fecha: Date) => {
  // Si la fecha cae a medianoche exacta UTC (00:00:00.000Z), representa el inicio de ese día o el corte
  // al primer día del mes entrante (e.g. 2026-09-01T00:00:00.000Z). Para efectos de vigencia auditable,
  // el último día auditable concluyó el día anterior (ej. 2026-08-31).
  if (
    fecha.getUTCHours() === 0 &&
    fecha.getUTCMinutes() === 0 &&
    fecha.getUTCSeconds() === 0 &&
    fecha.getUTCMilliseconds() === 0
  ) {
    const diaAnterior = new Date(fecha.getTime() - 1);
    return serialFechaUtc(diaAnterior);
  }
  return serialFechaUtc(fecha);
};

export function fechaFinDeMes(anio: number, mes: number): Date {
  return new Date(anio, mes, 0, 23, 59, 59, 999);
}

export function fechaInicioDeMes(anio: number, mes: number): Date {
  return new Date(anio, mes - 1, 1, 0, 0, 0, 0);
}

export function areaEsAuditableEnPeriodo(
  area: { activo: boolean; auditableDesde: Date | null; auditableHasta: Date | null },
  anio: number,
  mes: number,
  diaTermino: number,
): boolean {
  const serialPeriodoTermino = serialFechaPeriodo(anio, mes, diaTermino);
  const diaInicio = diaTermino <= 15 ? 1 : 16;
  const serialPeriodoInicio = serialFechaPeriodo(anio, mes, diaInicio);

  const serialDesde = area.auditableDesde ? serialFechaUtc(area.auditableDesde) : null;
  const serialHasta = area.auditableHasta ? serialFechaEfectivaHasta(area.auditableHasta) : null;

  // Reactivación / Multi-ciclo: área dada de baja en el pasado y reactivada después (auditableDesde > auditableHasta)
  // Ej: Enero-Julio activa (hasta Jul 31), reactivada en Noviembre (desde Nov 1)
  if (serialDesde !== null && serialHasta !== null && serialDesde > serialHasta) {
    if (serialPeriodoTermino >= serialDesde) {
      return area.activo;
    }
    if (serialHasta >= serialPeriodoTermino) {
      return true;
    }
    return false;
  }

  // Rango estándar: si tiene fecha fin (auditableHasta)
  if (serialHasta !== null) {
    // Si la vigencia concluyó antes del inicio de este período, el área NO es auditable
    if (serialHasta < serialPeriodoInicio) return false;
    // Si la vigencia concluyó antes del término del período y el área ya no está activa, NO es auditable
    if (serialHasta < serialPeriodoTermino && !area.activo) return false;
  }

  // Si tiene fecha inicio (auditableDesde)
  if (serialDesde !== null) {
    if (serialDesde > serialPeriodoTermino) return false;
  }

  // Si el área tiene auditableHasta y está marcada como activo=false:
  // Es auditable si y solo si el periodo cae enteramente dentro de su ventana auditable histórica
  if (serialHasta !== null && !area.activo) {
    return serialHasta >= serialPeriodoTermino;
  }

  return area.activo;
}

export async function obtenerImpactoDesactivacion(
  tx: PrismaTransaction,
  areaId: number,
) {
  const ahora = new Date();
  const anio = ahora.getFullYear();
  const mes = ahora.getMonth() + 1;

  const area = await tx.area.findUniqueOrThrow({ where: { id: areaId } });

  // 1. Auditorías programadas en este mes y meses posteriores que no tienen envioResultado definitivo
  const objetivosFuturos = await tx.objetivoAuditoria.findMany({
    where: {
      areaId,
      envioResultadoId: null,
      OR: [
        { anio: { gt: anio } },
        { anio, mes: { gte: mes } },
      ],
    },
    include: {
      asignacionesAuditoria: {
        where: { estado: { not: EstadoAsignacionAuditoria.CANCELADA } },
      },
    },
  });

  const objetivosEsteMes = objetivosFuturos.filter(
    (o) => o.anio === anio && o.mes === mes,
  );
  const objetivosPosteriores = objetivosFuturos.filter(
    (o) => o.anio > anio || (o.anio === anio && o.mes > mes),
  );

  const auditoresSet = new Set<number>();
  for (const obj of objetivosFuturos) {
    for (const asig of obj.asignacionesAuditoria) {
      auditoresSet.add(asig.auditorId);
    }
  }

  return {
    areaId: area.id,
    nombreArea: area.nombre,
    mesActual: { anio, mes },
    objetivosEsteMes: objetivosEsteMes.length,
    objetivosPosteriores: objetivosPosteriores.length,
    auditoresAfectados: auditoresSet.size,
  };
}

export async function procesarDesactivacionArea(
  tx: PrismaTransaction,
  areaId: number,
  efectivaDesde: 'ESTE_MES' | 'PROXIMO_MES',
  _usuarioId = 1,
) {
  const ahora = new Date();
  const anioActual = ahora.getFullYear();
  const mesActual = ahora.getMonth() + 1;

  let auditableHasta: Date;
  let anioFiltroObjetivos: number;
  let mesFiltroObjetivos: number;

  if (efectivaDesde === 'ESTE_MES') {
    // Deja de aplicar en este mes: auditableHasta es el último día del mes anterior
    auditableHasta = fechaFinDeMes(anioActual, mesActual - 1);
    anioFiltroObjetivos = anioActual;
    mesFiltroObjetivos = mesActual;
  } else {
    // A partir del próximo mes: auditableHasta es el último día de este mes
    auditableHasta = fechaFinDeMes(anioActual, mesActual);
    const siguienteMes = mesActual === 12 ? 1 : mesActual + 1;
    const siguienteAnio = mesActual === 12 ? anioActual + 1 : anioActual;
    anioFiltroObjetivos = siguienteAnio;
    mesFiltroObjetivos = siguienteMes;
  }

  // 1. Actualizar el área
  const areaActualizada = await tx.area.update({
    where: { id: areaId },
    data: {
      // Una baja futura conserva la actividad hasta que termine el mes vigente.
      activo: efectivaDesde === 'PROXIMO_MES',
      auditableHasta,
    },
  });

  // 2. Buscar objetivos de auditoría desde la fecha de efectividad en adelante
  const objetivosAAfectar = await tx.objetivoAuditoria.findMany({
    where: {
      areaId,
      OR: [
        { anio: { gt: anioFiltroObjetivos } },
        { anio: anioFiltroObjetivos, mes: { gte: mesFiltroObjetivos } },
      ],
    },
    include: {
      asignacionesAuditoria: true,
    },
  });

  let objetivosCanceladosCount = 0;
  let asignacionesCanceladasCount = 0;

  for (const obj of objetivosAAfectar) {
    // Si NO tiene envío verificado/resultado permanente, marcar el objetivo como cancelado e inhabilitar asignaciones
    if (!obj.envioResultadoId) {
      objetivosCanceladosCount += 1;

      await tx.objetivoAuditoria.update({
        where: { id: obj.id },
        data: {
          canceladoEn: ahora,
          motivoCancelacion: 'AREA_DESACTIVADA',
        },
      });

      for (const asig of obj.asignacionesAuditoria) {
        if (asig.estado !== EstadoAsignacionAuditoria.CANCELADA && asig.estado !== EstadoAsignacionAuditoria.COMPLETADA) {
          await tx.asignacionAuditoria.update({
            where: { id: asig.id },
            data: {
              estado: EstadoAsignacionAuditoria.CANCELADA,
              canceladoEn: ahora,
              motivoCancelacion: 'AREA_DESACTIVADA',
            },
          });
          asignacionesCanceladasCount += 1;

          // Revocar enlaces de invitado asociados si existen
          await tx.enlaceInvitado.updateMany({
            where: { asignacionAuditoriaId: asig.id, revocadoEn: null, usadoEn: null },
            data: { revocadoEn: ahora },
          });
        }
      }
    }
  }

  return {
    area: areaActualizada,
    objetivosCancelados: objetivosCanceladosCount,
    asignacionesCanceladas: asignacionesCanceladasCount,
  };
}

export async function procesarReactivacionArea(
  tx: PrismaTransaction,
  areaId: number,
  inicioProgramaAuditoria: 'ESTE_MES' | 'PROXIMO_MES',
  _usuarioId = 1,
) {
  const ahora = new Date();
  const anioActual = ahora.getFullYear();
  const mesActual = ahora.getMonth() + 1;

  let auditableDesde: Date;
  if (inicioProgramaAuditoria === 'ESTE_MES') {
    auditableDesde = fechaInicioDeMes(anioActual, mesActual);
  } else {
    const sigMes = mesActual === 12 ? 1 : mesActual + 1;
    const sigAnio = mesActual === 12 ? anioActual + 1 : anioActual;
    auditableDesde = fechaInicioDeMes(sigAnio, sigMes);
  }

  const areaActualizada = await tx.area.update({
    where: { id: areaId },
    data: {
      activo: true,
      auditableDesde,
      auditableHasta: null,
    },
  });

  return areaActualizada;
}
