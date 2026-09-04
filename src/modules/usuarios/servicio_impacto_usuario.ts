import type { PrismaTransaction } from '../../db';
import { EstadoAsignacionAuditoria } from '../../generated/prisma/enums';
import { conflicto, solicitudInvalida } from '../../utils/errores';
import { calcularCierreConGracia } from '../../utils/periodos';
import { bloquearObjetivoAuditoria, validarAuditorAsignable } from '../asignaciones/helper';
import { obtenerVistaMensual } from '../asignaciones/programacion_mensual';
import { clasificarAsignacionParaReasignacion } from '../asignaciones/servicio_reasignacion';
import { registrarAuditoria } from '../registros_auditoria/helper';

type DecisionResponsabilidad = {
  relacionId: number;
  areaId: number;
  accion: 'SIN_REEMPLAZO' | 'REEMPLAZAR';
  nuevoResponsableId?: number | null;
};

type DecisionAuditoria = {
  clave: string;
  asignacionIds: number[];
  asignacionMensualId?: number | null;
  auditorMensualId?: number | null;
  accion: 'PENDIENTE' | 'REASIGNAR';
  nuevoAuditorId?: number | null;
};

type ResolucionCambioUsuario = {
  usuarioActualizadoEn: Date;
  responsabilidades?: DecisionResponsabilidad[];
  auditorias: DecisionAuditoria[];
};

const claveGrupo = (areaId: number, anio: number, mes: number) => `${areaId}:${anio}:${mes}`;

const cargarUsuario = (tx: PrismaTransaction, usuarioId: number) => tx.usuario.findUniqueOrThrow({
  where: { id: usuarioId },
  select: {
    id: true,
    nombre: true,
    nombreUsuario: true,
    rol: true,
    activo: true,
    actualizadoEn: true,
    areasUsuario: {
      include: {
        area: {
          select: {
            id: true,
            codigo: true,
            nombre: true,
            tipo: true,
            activo: true,
            usuariosArea: {
              where: { usuario: { activo: true } },
              include: { usuario: { select: { id: true, nombre: true, nombreUsuario: true } } },
            },
          },
        },
      },
      orderBy: { id: 'asc' },
    },
  },
});

const cargarAsignaciones = (tx: PrismaTransaction, usuarioId: number) => tx.asignacionAuditoria.findMany({
  where: { auditorId: usuarioId, estado: { not: EstadoAsignacionAuditoria.CANCELADA } },
  include: {
    objetivoAuditoria: {
      include: {
        area: {
          select: {
            id: true,
            codigo: true,
            nombre: true,
            tipo: true,
            usuariosArea: { select: { usuarioId: true } },
          },
        },
        envioResultado: true,
        enviosAuditoria: true,
      },
    },
  },
  orderBy: [
    { objetivoAuditoria: { anio: 'asc' } },
    { objetivoAuditoria: { mes: 'asc' } },
    { objetivoAuditoria: { area: { nombre: 'asc' } } },
    { objetivoAuditoria: { periodo: 'asc' } },
  ],
});

export const obtenerImpactoCambioUsuario = async (tx: PrismaTransaction, usuarioId: number) => {
  const [usuario, asignaciones, personasActivas] = await Promise.all([
    cargarUsuario(tx, usuarioId),
    cargarAsignaciones(tx, usuarioId),
    tx.usuario.findMany({
      where: { activo: true, id: { not: usuarioId } },
      select: { id: true, nombre: true, nombreUsuario: true, rol: true, activo: true },
      orderBy: { nombre: 'asc' },
    }),
  ]);

  const asignacionesReasignables = asignaciones.filter((asignacion) => (
    clasificarAsignacionParaReasignacion(asignacion.objetivoAuditoria, asignacion).categoria === 'REASIGNABLE'
  ));
  const areasResponsabilidadIds = usuario.areasUsuario.map((relacion) => relacion.areaId);
  const conflictosResponsables = new Set<string>();

  if (areasResponsabilidadIds.length && personasActivas.length) {
    const asignacionesCandidatos = await tx.asignacionAuditoria.findMany({
      where: {
        auditorId: { in: personasActivas.map((persona) => persona.id) },
        estado: { not: EstadoAsignacionAuditoria.CANCELADA },
        objetivoAuditoria: { areaId: { in: areasResponsabilidadIds } },
      },
      include: { objetivoAuditoria: { include: { envioResultado: true, enviosAuditoria: true } } },
    });
    for (const asignacion of asignacionesCandidatos) {
      if (clasificarAsignacionParaReasignacion(asignacion.objetivoAuditoria, asignacion).categoria === 'REASIGNABLE') {
        conflictosResponsables.add(`${asignacion.auditorId}:${asignacion.objetivoAuditoria.areaId}`);
      }
    }
  }

  const responsabilidades = usuario.areasUsuario.map((relacion) => ({
    relacionId: relacion.id,
    area: {
      id: relacion.area.id,
      codigo: relacion.area.codigo,
      nombre: relacion.area.nombre,
      tipo: relacion.area.tipo,
      activo: relacion.area.activo,
    },
    otrosResponsables: relacion.area.usuariosArea
      .filter((actual) => actual.usuarioId !== usuarioId)
      .map((actual) => actual.usuario),
    candidatos: personasActivas
      .filter((persona) => !conflictosResponsables.has(`${persona.id}:${relacion.areaId}`))
      .map(({ id, nombre, nombreUsuario }) => ({ id, nombre, nombreUsuario })),
  }));

  const grupos = new Map<string, typeof asignacionesReasignables>();
  for (const asignacion of asignacionesReasignables) {
    const objetivo = asignacion.objetivoAuditoria;
    const clave = claveGrupo(objetivo.areaId, objetivo.anio, objetivo.mes);
    const grupo = grupos.get(clave) ?? [];
    grupo.push(asignacion);
    grupos.set(clave, grupo);
  }

  const auditorias = [];
  const cargasPorMes = new Map<string, Map<number, number>>();
  for (const [clave, grupo] of grupos) {
    const objetivoBase = grupo[0].objetivoAuditoria;
    const [vista, mensual] = await Promise.all([
      obtenerVistaMensual(tx, objetivoBase.anio, objetivoBase.mes),
      tx.asignacionMensual.findUnique({
        where: {
          areaId_anio_mes: {
            areaId: objetivoBase.areaId,
            anio: objetivoBase.anio,
            mes: objetivoBase.mes,
          },
        },
        select: { id: true, auditorId: true },
      }),
    ]);
    const responsablesIds = new Set(objetivoBase.area.usuariosArea.map((relacion) => relacion.usuarioId));
    const claveMes = `${objetivoBase.anio}:${objetivoBase.mes}`;
    const cargas = cargasPorMes.get(claveMes)
      ?? new Map(vista.auditores.map((auditor) => [auditor.id, auditor.areasAsignadas]));
    cargasPorMes.set(claveMes, cargas);
    const candidatos = vista.auditores
      .filter((auditor) => auditor.id !== usuarioId && !responsablesIds.has(auditor.id))
      .sort((a, b) => (cargas.get(a.id) ?? 0) - (cargas.get(b.id) ?? 0) || a.nombre.localeCompare(b.nombre, 'es'));
    const auditorSugerido = candidatos[0] ?? null;
    if (auditorSugerido) cargas.set(auditorSugerido.id, (cargas.get(auditorSugerido.id) ?? 0) + 1);

    auditorias.push({
      clave,
      area: {
        id: objetivoBase.area.id,
        codigo: objetivoBase.area.codigo,
        nombre: objetivoBase.area.nombre,
        tipo: objetivoBase.area.tipo,
      },
      anio: objetivoBase.anio,
      mes: objetivoBase.mes,
      asignacionIds: grupo.map((asignacion) => asignacion.id).sort((a, b) => a - b),
      asignacionMensual: mensual,
      periodos: grupo.map((asignacion) => {
        const clasificacion = clasificarAsignacionParaReasignacion(asignacion.objetivoAuditoria, asignacion);
        return {
          asignacionId: asignacion.id,
          objetivoAuditoriaId: asignacion.objetivoAuditoriaId,
          periodo: asignacion.objetivoAuditoria.periodo,
          estado: asignacion.estado,
          situacion: clasificacion.detalle.situacion,
          reabiertaHasta: asignacion.reabiertaHasta,
        };
      }),
      candidatos,
      auditorSugerido,
    });
  }

  const historico = asignaciones.reduce((resumen, asignacion) => {
    const categoria = clasificarAsignacionParaReasignacion(asignacion.objetivoAuditoria, asignacion).categoria;
    if (categoria === 'COMPLETADA') resumen.completadas += 1;
    if (categoria === 'VENCIDA') resumen.vencidas += 1;
    return resumen;
  }, { completadas: 0, vencidas: 0 });

  return {
    usuario: {
      id: usuario.id,
      nombre: usuario.nombre,
      nombreUsuario: usuario.nombreUsuario,
      rol: usuario.rol,
      activo: usuario.activo,
      actualizadoEn: usuario.actualizadoEn,
    },
    responsabilidades,
    auditorias,
    historico,
  };
};

const mismosIds = (actuales: number[], esperados: number[]) => (
  actuales.length === esperados.length
  && [...actuales].sort((a, b) => a - b).every((id, indice) => id === [...esperados].sort((a, b) => a - b)[indice])
);

export const validarSnapshotAsignaciones = (actuales: number[], esperados: number[]) => {
  if (!mismosIds(actuales, esperados)) {
    throw conflicto('Las auditorías pendientes cambiaron desde que abriste el modal. No se sobrescribió ningún cambio.');
  }
};

export const aplicarResolucionesAuditoriasUsuario = async (
  tx: PrismaTransaction,
  usuarioId: number,
  resolucion: ResolucionCambioUsuario,
  actorId: number,
  motivo: 'AUDITOR_INACTIVO' | 'AUDITOR_SIN_ROL_EJECUTABLE',
) => {
  const impacto = await obtenerImpactoCambioUsuario(tx, usuarioId);
  if (!impacto.usuario.activo) throw conflicto('El usuario ya se encuentra inactivo');
  if (impacto.usuario.actualizadoEn.getTime() !== resolucion.usuarioActualizadoEn.getTime()) {
    throw conflicto('El usuario cambió desde que abriste el modal. Actualiza el impacto antes de confirmar.');
  }

  const gruposActuales = new Map(impacto.auditorias.map((grupo) => [grupo.clave, grupo]));
  validarSnapshotAsignaciones(
    [...gruposActuales.values()].flatMap((grupo) => grupo.asignacionIds),
    resolucion.auditorias.flatMap((decision) => decision.asignacionIds),
  );

  let reasignadas = 0;
  let pendientes = 0;
  for (const decision of resolucion.auditorias) {
    const grupo = gruposActuales.get(decision.clave);
    if (!grupo || !mismosIds(grupo.asignacionIds, decision.asignacionIds)) {
      throw conflicto('Una asignación fue modificada por otro administrador. Actualiza el impacto e inténtalo de nuevo.');
    }
    if ((grupo.asignacionMensual?.id ?? null) !== (decision.asignacionMensualId ?? null)
      || (grupo.asignacionMensual?.auditorId ?? null) !== (decision.auditorMensualId ?? null)) {
      throw conflicto('La asignación mensual cambió desde que abriste el modal. No se sobrescribió el cambio.');
    }

    const nuevoAuditorId = decision.accion === 'REASIGNAR' ? decision.nuevoAuditorId : null;
    if (decision.accion === 'REASIGNAR' && !nuevoAuditorId) {
      throw solicitudInvalida('Selecciona un auditor para cada grupo que deseas reasignar');
    }
    if (nuevoAuditorId === usuarioId) throw solicitudInvalida('El usuario afectado no puede sustituirse a sí mismo');
    if (nuevoAuditorId && !grupo.candidatos.some((candidato) => candidato.id === nuevoAuditorId)) {
      throw conflicto('El auditor seleccionado ya no es elegible para esta área');
    }

    const objetivoBase = grupo.periodos[0];
    let asignacionMensualId: number | null = null;
    if (nuevoAuditorId) {
      await validarAuditorAsignable(tx, nuevoAuditorId, objetivoBase.objetivoAuditoriaId);
      if (grupo.asignacionMensual && grupo.asignacionMensual.auditorId !== usuarioId
        && grupo.asignacionMensual.auditorId !== nuevoAuditorId) {
        throw conflicto('El mes ya tiene una decisión administrativa distinta. Revísala desde Asignaciones.');
      }
      if (grupo.asignacionMensual) {
        await tx.asignacionAuditoria.updateMany({
          where: { asignacionMensualId: grupo.asignacionMensual.id, auditorId: usuarioId },
          data: { asignacionMensualId: null },
        });
      }
      const mensual = await tx.asignacionMensual.upsert({
        where: { areaId_anio_mes: { areaId: grupo.area.id, anio: grupo.anio, mes: grupo.mes } },
        update: { auditorId: nuevoAuditorId, asignadoPorId: actorId, asignadoEn: new Date() },
        create: {
          areaId: grupo.area.id,
          anio: grupo.anio,
          mes: grupo.mes,
          auditorId: nuevoAuditorId,
          asignadoPorId: actorId,
          asignadoEn: new Date(),
        },
      });
      asignacionMensualId = mensual.id;
    } else if (grupo.asignacionMensual?.auditorId === usuarioId) {
      await tx.asignacionAuditoria.updateMany({
        where: { asignacionMensualId: grupo.asignacionMensual.id },
        data: { asignacionMensualId: null },
      });
      await tx.asignacionMensual.delete({ where: { id: grupo.asignacionMensual.id } });
    }

    for (const asignacionId of grupo.asignacionIds) {
      const asignacion = await tx.asignacionAuditoria.findUniqueOrThrow({
        where: { id: asignacionId },
        include: { objetivoAuditoria: { include: { envioResultado: true, enviosAuditoria: true } } },
      });
      if (asignacion.auditorId !== usuarioId
        || clasificarAsignacionParaReasignacion(asignacion.objetivoAuditoria, asignacion).categoria !== 'REASIGNABLE') {
        throw conflicto('Una auditoría dejó de estar disponible para reasignación. No se aplicaron cambios.');
      }
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

      if (!nuevoAuditorId) {
        pendientes += 1;
        continue;
      }
      await bloquearObjetivoAuditoria(tx, asignacion.objetivoAuditoriaId);
      const creada = await tx.asignacionAuditoria.create({
        data: {
          asignacionMensualId,
          objetivoAuditoriaId: asignacion.objetivoAuditoriaId,
          auditorId: nuevoAuditorId,
          asignadoPorId: actorId,
          estado: EstadoAsignacionAuditoria.PENDIENTE,
          asignadoEn: new Date(),
          venceEn: asignacion.reabiertaHasta ?? asignacion.objetivoAuditoria.terminaEn,
          reabiertaHasta: asignacion.reabiertaHasta,
          reabiertaEn: asignacion.reabiertaEn,
          reabiertaPorId: asignacion.reabiertaPorId,
          motivoReapertura: asignacion.motivoReapertura,
          motivoExcepcion: 'Sustitución de auditor',
        },
      });
      await registrarAuditoria({
        usuarioId: actorId,
        accion: 'REASIGNAR_AUDITOR_USUARIO',
        tipoEntidad: 'AsignacionAuditoria',
        idEntidad: creada.id,
        datosAnteriores: asignacion,
        datosNuevos: creada,
      }, tx);
      reasignadas += 1;
    }
  }

  return { impacto, reasignadas, pendientes };
};

export const aplicarResolucionesResponsabilidadUsuario = async (
  tx: PrismaTransaction,
  usuarioId: number,
  decisiones: DecisionResponsabilidad[],
  impacto: Awaited<ReturnType<typeof obtenerImpactoCambioUsuario>>,
  actorId: number,
) => {
  const relacionesActuales = impacto.responsabilidades;
  if (!mismosIds(relacionesActuales.map((item) => item.relacionId), decisiones.map((item) => item.relacionId))) {
    throw conflicto('Las responsabilidades del usuario cambiaron. Actualiza el impacto antes de confirmar.');
  }

  let reemplazadas = 0;
  let sinReemplazo = 0;
  for (const decision of decisiones) {
    const actual = relacionesActuales.find((item) => item.relacionId === decision.relacionId && item.area.id === decision.areaId);
    if (!actual) throw conflicto('Una responsabilidad de área cambió mientras revisabas la baja');

    if (decision.accion === 'REEMPLAZAR') {
      if (!decision.nuevoResponsableId) throw solicitudInvalida('Selecciona la nueva persona responsable del área');
      if (!actual.candidatos.some((candidato) => candidato.id === decision.nuevoResponsableId)) {
        throw conflicto('La persona seleccionada ya no puede quedar relacionada con esta área');
      }
      await tx.usuarioArea.upsert({
        where: { usuarioId_areaId: { usuarioId: decision.nuevoResponsableId, areaId: decision.areaId } },
        update: {},
        create: { usuarioId: decision.nuevoResponsableId, areaId: decision.areaId },
      });
      reemplazadas += 1;
    } else {
      sinReemplazo += 1;
    }

    await tx.usuarioArea.delete({ where: { id: decision.relacionId } });
    await registrarAuditoria({
      usuarioId: actorId,
      accion: decision.accion === 'REEMPLAZAR' ? 'REEMPLAZAR_RESPONSABLE_BAJA' : 'QUITAR_RESPONSABLE_BAJA',
      tipoEntidad: 'UsuarioArea',
      idEntidad: decision.relacionId,
      datosAnteriores: { usuarioId, areaId: decision.areaId },
      datosNuevos: decision.accion === 'REEMPLAZAR'
        ? { usuarioId: decision.nuevoResponsableId, areaId: decision.areaId }
        : null,
    }, tx);
  }
  return { reemplazadas, sinReemplazo };
};

export const validarCruceResponsablesAuditores = (
  responsabilidades: DecisionResponsabilidad[],
  auditorias: DecisionAuditoria[],
) => {
  const nuevosResponsables = new Set(
    responsabilidades
      .filter((decision) => decision.accion === 'REEMPLAZAR' && decision.nuevoResponsableId)
      .map((decision) => `${decision.areaId}:${decision.nuevoResponsableId}`),
  );
  for (const decision of auditorias) {
    if (decision.accion !== 'REASIGNAR' || !decision.nuevoAuditorId) continue;
    const [areaId] = decision.clave.split(':');
    if (nuevosResponsables.has(`${areaId}:${decision.nuevoAuditorId}`)) {
      throw solicitudInvalida('Una persona no puede quedar como responsable y auditor de la misma área');
    }
  }
};
