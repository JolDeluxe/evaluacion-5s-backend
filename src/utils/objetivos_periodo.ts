import { prisma, type PrismaTransaction } from '../db';
import { EstadoAsignacionAuditoria } from '../generated/prisma/enums';
import { assertObjetivoRealizable, assertObjetivoRealizableParaAuditor, compararObjetivosPorPeriodo, objetivoEsRealizable } from './periodos';

const includePeriodo = {
  envioResultado: true,
  area: { select: { id: true, nombre: true, codigo: true } },
  asignacionesAuditoria: {
    where: { estado: { not: EstadoAsignacionAuditoria.CANCELADA } },
    include: { auditor: { select: { id: true, nombre: true } } },
    orderBy: { creadoEn: 'desc' as const },
  },
} as const;

export const obtenerObjetivoRealizableMasAntiguo = async (
  tx: PrismaTransaction | typeof prisma,
  areaId: number,
  ahora = new Date(),
) => {
  const objetivos = await tx.objetivoAuditoria.findMany({
    where: {
      areaId,
      iniciaEn: { lte: ahora },
    },
    include: includePeriodo,
  });

  return objetivos
    .filter((objetivo) => {
      const asignacionActiva = objetivo.asignacionesAuditoria.find((a) => a.estado !== EstadoAsignacionAuditoria.CANCELADA);
      const reabiertaHasta = asignacionActiva?.reabiertaHasta ?? null;
      return objetivoEsRealizable(objetivo, ahora, reabiertaHasta);
    })
    .sort(compararObjetivosPorPeriodo)[0] ?? null;
};

export const validarObjetivoRealizableMasAntiguo = async (
  tx: PrismaTransaction | typeof prisma,
  objetivoAuditoriaId: number,
  auditorId?: number | null,
  ahora = new Date(),
  reabiertaHasta?: Date | null,
) => {
  if (auditorId) {
    return assertObjetivoRealizableParaAuditor(tx, objetivoAuditoriaId, auditorId, ahora, reabiertaHasta);
  }
  const objetivo = await tx.objetivoAuditoria.findUniqueOrThrow({
    where: { id: objetivoAuditoriaId },
    include: includePeriodo,
  });
  assertObjetivoRealizable(objetivo, null, ahora, reabiertaHasta);
  return objetivo;
};

