import { prisma, type PrismaTransaction } from '../db';
import { EstadoAsignacionAuditoria } from '../generated/prisma/enums';
import { assertObjetivoRealizable, compararObjetivosPorPeriodo, objetivoEsRealizable } from './periodos';

const includePeriodo = {
  envioResultado: true,
  asignacionesAuditoria: {
    where: { estado: { not: EstadoAsignacionAuditoria.CANCELADA } },
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
  ahora = new Date(),
  reabiertaHasta?: Date | null,
) => {
  const objetivo = await tx.objetivoAuditoria.findUniqueOrThrow({
    where: { id: objetivoAuditoriaId },
    include: includePeriodo,
  });
  const objetivoMasAntiguo = await obtenerObjetivoRealizableMasAntiguo(tx, objetivo.areaId, ahora);
  assertObjetivoRealizable(objetivo, objetivoMasAntiguo, ahora, reabiertaHasta);
  return objetivo;
};
