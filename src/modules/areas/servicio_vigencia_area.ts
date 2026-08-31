import type { PrismaTransaction } from '../../db';
import { EstadoAsignacionAuditoria } from '../../generated/prisma/enums';

const serialFechaPeriodo = (anio: number, mes: number, dia: number) => anio * 10000 + mes * 100 + dia;
const serialFechaUtc = (fecha: Date) => (
  fecha.getUTCFullYear() * 10000 + (fecha.getUTCMonth() + 1) * 100 + fecha.getUTCDate()
);

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
  const serialPeriodo = serialFechaPeriodo(anio, mes, diaTermino);

  if (area.auditableHasta) {
    const serialInicioPeriodo = serialFechaPeriodo(anio, mes, 1);
    if (serialFechaUtc(area.auditableHasta) >= serialInicioPeriodo) {
      return true;
    }
  }

  if (area.auditableDesde && serialFechaUtc(area.auditableDesde) > serialPeriodo) {
    return false;
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
      activo: false,
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
