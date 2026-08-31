import type { EnvioAuditoria, ObjetivoAuditoria } from '../generated/prisma/client';
import { conflicto } from './errores';

export const DIAS_HABILES_GRACIA = 5;

export const SituacionObjetivo = {
  PENDIENTE: 'PENDIENTE',
  ATRASADA_EN_GRACIA: 'ATRASADA_EN_GRACIA',
  REALIZADA_A_TIEMPO: 'REALIZADA_A_TIEMPO',
  REALIZADA_CON_ATRASO: 'REALIZADA_CON_ATRASO',
  NO_REALIZADA: 'NO_REALIZADA',
} as const;

export type SituacionObjetivo = (typeof SituacionObjetivo)[keyof typeof SituacionObjetivo];

type ObjetivoConPeriodo = Pick<ObjetivoAuditoria, 'id' | 'areaId' | 'envioResultadoId' | 'anio' | 'mes' | 'periodo' | 'iniciaEn' | 'terminaEn'> & {
  envioResultado: Pick<EnvioAuditoria, 'id' | 'verificadoEn' | 'invalidadoEn' | 'porcentaje'> | null;
  enviosAuditoria?: Pick<EnvioAuditoria, 'id' | 'verificadoEn' | 'invalidadoEn' | 'porcentaje'>[];
};

export const esDiaHabil = (fecha: Date) => {
  const dia = fecha.getDay();
  return dia >= 1 && dia <= 5;
};

export const sumarDiasHabiles = (fecha: Date, dias: number) => {
  const resultado = new Date(fecha);
  let restantes = dias;

  while (restantes > 0) {
    resultado.setDate(resultado.getDate() + 1);
    if (esDiaHabil(resultado)) restantes -= 1;
  }

  return resultado;
};

export const calcularCierreConGracia = (terminaEn: Date) => sumarDiasHabiles(terminaEn, DIAS_HABILES_GRACIA);

export const tieneEnvioResultadoValido = (objetivo: Pick<ObjetivoConPeriodo, 'envioResultado'>) =>
  Boolean(objetivo.envioResultado && !objetivo.envioResultado.invalidadoEn);

export const derivarSituacionObjetivo = (objetivo: ObjetivoConPeriodo, ahora = new Date()) => {
  const cierreGracia = calcularCierreConGracia(objetivo.terminaEn);
  const enviosValidos = (objetivo.enviosAuditoria || []).filter((e) => !e.invalidadoEn);
  const envioValido = objetivo.envioResultado && !objetivo.envioResultado.invalidadoEn
    ? objetivo.envioResultado
    : null;

  if (envioValido) {
    return {
      situacion: envioValido.verificadoEn <= objetivo.terminaEn
        ? SituacionObjetivo.REALIZADA_A_TIEMPO
        : SituacionObjetivo.REALIZADA_CON_ATRASO,
      cierreGracia,
      fechaRealizacion: envioValido.verificadoEn,
      realizada: true,
    };
  }

  if (enviosValidos.length > 0) {
    const enviosOrdenados = [...enviosValidos].sort((a, b) => a.verificadoEn.getTime() - b.verificadoEn.getTime());
    const primerEnvio = enviosOrdenados[0];
    return {
      situacion: primerEnvio.verificadoEn <= objetivo.terminaEn
        ? SituacionObjetivo.REALIZADA_A_TIEMPO
        : SituacionObjetivo.REALIZADA_CON_ATRASO,
      cierreGracia,
      fechaRealizacion: primerEnvio.verificadoEn,
      realizada: true,
    };
  }

  if (ahora <= objetivo.terminaEn) {
    return { situacion: SituacionObjetivo.PENDIENTE, cierreGracia, fechaRealizacion: null, realizada: false };
  }
  if (ahora <= cierreGracia) {
    return { situacion: SituacionObjetivo.ATRASADA_EN_GRACIA, cierreGracia, fechaRealizacion: null, realizada: false };
  }
  return { situacion: SituacionObjetivo.NO_REALIZADA, cierreGracia, fechaRealizacion: null, realizada: false };
};

export const objetivoEsRealizable = (objetivo: ObjetivoConPeriodo, ahora = new Date(), reabiertaHasta?: Date | null) => (
  objetivo.iniciaEn <= ahora
  && !tieneEnvioResultadoValido(objetivo)
  && (ahora <= calcularCierreConGracia(objetivo.terminaEn) || Boolean(reabiertaHasta && ahora <= reabiertaHasta))
);

export const compararObjetivosPorPeriodo = (a: ObjetivoConPeriodo, b: ObjetivoConPeriodo) => {
  const porInicio = a.iniciaEn.getTime() - b.iniciaEn.getTime();
  if (porInicio !== 0) return porInicio;
  const porAnio = a.anio - b.anio;
  if (porAnio !== 0) return porAnio;
  const porMes = a.mes - b.mes;
  if (porMes !== 0) return porMes;
  return a.periodo - b.periodo;
};

export const assertObjetivoRealizable = (objetivo: ObjetivoConPeriodo, objetivoMasAntiguo: ObjetivoConPeriodo | null, ahora = new Date(), reabiertaHasta?: Date | null) => {
  if (!objetivoEsRealizable(objetivo, ahora, reabiertaHasta)) {
    const detalle = derivarSituacionObjetivo(objetivo, ahora);
    throw conflicto(`El periodo no esta disponible para captura: ${detalle.situacion}`);
  }
  if (objetivoMasAntiguo && objetivoMasAntiguo.id !== objetivo.id) throw conflicto('Existe un periodo anterior de esta area que debe resolverse primero');
};

export const construirDetalleAdminPeriodo = (objetivo: ObjetivoConPeriodo, ahora = new Date(), reabiertaHasta?: Date | null) => {
  const detalle = derivarSituacionObjetivo(objetivo, ahora);
  return {
    objetivoAuditoriaId: objetivo.id,
    numeroCorte: objetivo.periodo,
    anio: objetivo.anio,
    mes: objetivo.mes,
    iniciaEn: objetivo.iniciaEn,
    terminaEn: objetivo.terminaEn,
    cierreGracia: detalle.cierreGracia,
    fechaRealizacion: detalle.fechaRealizacion,
    porcentaje: objetivo.envioResultado && !objetivo.envioResultado.invalidadoEn ? Number(objetivo.envioResultado.porcentaje) : null,
    situacion: detalle.situacion,
    realizada: detalle.realizada,
    realizadaATiempo: detalle.situacion === SituacionObjetivo.REALIZADA_A_TIEMPO,
    realizadaConAtraso: detalle.situacion === SituacionObjetivo.REALIZADA_CON_ATRASO,
    enGracia: detalle.situacion === SituacionObjetivo.ATRASADA_EN_GRACIA,
    reabierta: Boolean(reabiertaHasta && ahora <= reabiertaHasta),
    reabiertaHasta: reabiertaHasta ?? null,
  };
};

export const construirDetalleAuditorPeriodo = (objetivo: ObjetivoConPeriodo) => {
  const enviosValidos = (objetivo.enviosAuditoria || []).filter((e) => !e.invalidadoEn);
  return {
    objetivoAuditoriaId: objetivo.id,
    numeroCorte: objetivo.periodo,
    anio: objetivo.anio,
    mes: objetivo.mes,
    iniciaEn: objetivo.iniciaEn,
    terminaEn: objetivo.terminaEn,
    realizada: tieneEnvioResultadoValido(objetivo) || enviosValidos.length > 0,
  };
};

export const construirPeriodoCompat = (
  objetivo: Pick<ObjetivoAuditoria, 'id' | 'anio' | 'mes' | 'periodo' | 'iniciaEn' | 'terminaEn'>,
) => ({
  id: objetivo.id,
  anio: objetivo.anio,
  mes: objetivo.mes,
  numeroCorte: objetivo.periodo,
  iniciaEn: objetivo.iniciaEn,
  terminaEn: objetivo.terminaEn,
});
