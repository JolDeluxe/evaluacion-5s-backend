import type { TipoArea } from '../../generated/prisma/enums';

export const promedio = (valores: number[]) => (
  valores.length ? valores.reduce((total, valor) => total + valor, 0) / valores.length : 0
);

export const construirWhereCiclo = (filtros: { anio?: number; mes?: number; numeroCorte?: number }) => ({
  ...(filtros.anio ? { anio: filtros.anio } : {}),
  ...(filtros.mes ? { mes: filtros.mes } : {}),
  ...(filtros.numeroCorte ? { numeroCorte: filtros.numeroCorte } : {}),
});

export const construirWhereObjetivo = (tipoArea?: TipoArea) => ({
  ...(tipoArea ? { tipoAreaSnapshot: tipoArea } : {}),
});

export const calcularGanadores = <T extends { porcentaje: number | null }>(items: T[]) => {
  const conResultado = items.filter((item) => item.porcentaje !== null);
  if (!conResultado.length) return [];
  const maximo = Math.max(...conResultado.map((item) => item.porcentaje ?? 0));
  return conResultado.filter((item) => item.porcentaje === maximo);
};
