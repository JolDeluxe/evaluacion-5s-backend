import { prisma, type PrismaTransaction } from '../db';
import { assertObjetivoRealizable, compararObjetivosPorPeriodo, objetivoEsRealizable } from './periodos';

const includePeriodo = {
  envioResultado: true,
} as const;

export const obtenerObjetivoRealizableMasAntiguo = async (
  tx: PrismaTransaction | typeof prisma,
  areaId: number,
  ahora = new Date()
) => {
  const objetivos = await tx.objetivoAuditoria.findMany({
    where: {
      areaId,
      iniciaEn: { lte: ahora },
    },
    include: includePeriodo,
  });

  return objetivos
    .filter((objetivo) => objetivoEsRealizable(objetivo, ahora))
    .sort(compararObjetivosPorPeriodo)[0] ?? null;
};

export const validarObjetivoRealizableMasAntiguo = async (
  tx: PrismaTransaction | typeof prisma,
  objetivoAuditoriaId: number,
  ahora = new Date(),
  reabiertaHasta?: Date | null
) => {
  const objetivo = await tx.objetivoAuditoria.findUniqueOrThrow({
    where: { id: objetivoAuditoriaId },
    include: includePeriodo,
  });
  const objetivoMasAntiguo = await obtenerObjetivoRealizableMasAntiguo(tx, objetivo.areaId, ahora);
  assertObjetivoRealizable(objetivo, objetivoMasAntiguo, ahora, reabiertaHasta);
  return objetivo;
};
