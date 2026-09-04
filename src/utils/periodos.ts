import type { EnvioAuditoria, ObjetivoAuditoria } from '../generated/prisma/client';
import type { PrismaTransaction } from '../db';
import { prisma } from '../db';
import { EstadoAsignacionAuditoria } from '../generated/prisma/enums';
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

export const MESES_NOMBRES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

export const obtenerPeriodoInmediatamenteAnterior = (anio: number, mes: number, periodo: number) => {
  if (periodo === 2) {
    return { anio, mes, periodo: 1 };
  }
  const prevMes = mes === 1 ? 12 : mes - 1;
  const prevAnio = mes === 1 ? anio - 1 : anio;
  return { anio: prevAnio, mes: prevMes, periodo: 2 };
};

export const obtenerAsignacionesBloqueadorasPeriodoAnterior = async (
  tx: PrismaTransaction | typeof prisma,
  auditorId: number,
  anioActual: number,
  mesActual: number,
  periodoActual: number,
  ahora = new Date(),
) => {
  const prev = obtenerPeriodoInmediatamenteAnterior(anioActual, mesActual, periodoActual);

  const asignacionesPrevias = await tx.asignacionAuditoria.findMany({
    where: {
      auditorId,
      estado: {
        notIn: [EstadoAsignacionAuditoria.CANCELADA, EstadoAsignacionAuditoria.COMPLETADA],
      },
      reabiertaHasta: null,
      objetivoAuditoria: {
        anio: prev.anio,
        mes: prev.mes,
        periodo: prev.periodo,
        envioResultadoId: null,
      },
    },
    include: {
      objetivoAuditoria: {
        include: {
          area: { select: { id: true, nombre: true, codigo: true } },
          envioResultado: true,
          enviosAuditoria: true,
        },
      },
    },
    orderBy: [
      { venceEn: 'asc' },
      { id: 'asc' },
    ],
  });

  return asignacionesPrevias.filter((asig) => {
    const obj = asig.objetivoAuditoria;
    if (tieneEnvioResultadoValido(obj)) return false;
    const cierreGracia = calcularCierreConGracia(obj.terminaEn);
    return ahora <= cierreGracia;
  });
};

export const construirPayloadBloqueoPeriodoAnterior = (
  prev: { anio: number; mes: number; periodo: number },
  bloqueadoras: Awaited<ReturnType<typeof obtenerAsignacionesBloqueadorasPeriodoAnterior>>,
  ahora = new Date(),
) => {
  const mesStr = `${prev.anio}-${String(prev.mes).padStart(2, '0')}`;
  const etiquetaStr = `${MESES_NOMBRES[prev.mes - 1]} ${prev.anio}`;

  const pendientes = bloqueadoras.map((asig) => {
    const esAtrasada = ahora > asig.objetivoAuditoria.terminaEn;
    return {
      asignacionId: asig.id,
      areaNombre: asig.objetivoAuditoria.area?.nombre ?? '',
      estado: esAtrasada ? 'ATRASADA' : 'PENDIENTE',
    };
  });

  return {
    periodoAnterior: {
      mes: mesStr,
      etiqueta: etiquetaStr,
      periodo: prev.periodo,
    },
    totalPendientes: bloqueadoras.length,
    pendientes,
    asignacionId: bloqueadoras[0]?.id ?? null,
    mesEtiqueta: etiquetaStr,
    periodo: prev.periodo,
    estado: pendientes[0]?.estado ?? 'PENDIENTE',
    areaNombre: bloqueadoras[0]?.objetivoAuditoria.area?.nombre ?? '',
  };
};

export const assertObjetivoRealizableParaAuditor = async (
  tx: PrismaTransaction | typeof prisma,
  objetivoAuditoriaId: number,
  auditorId: number,
  ahora = new Date(),
  reabiertaHasta?: Date | null,
) => {
  const objetivo = await tx.objetivoAuditoria.findUniqueOrThrow({
    where: { id: objetivoAuditoriaId },
    include: {
      envioResultado: true,
      enviosAuditoria: true,
      area: { select: { id: true, nombre: true, codigo: true } },
    },
  });

  if (!objetivoEsRealizable(objetivo, ahora, reabiertaHasta)) {
    const detalle = derivarSituacionObjetivo(objetivo, ahora);
    throw conflicto(`El periodo no esta disponible para captura: ${detalle.situacion}`);
  }

  const prev = obtenerPeriodoInmediatamenteAnterior(objetivo.anio, objetivo.mes, objetivo.periodo);
  const bloqueadoras = await obtenerAsignacionesBloqueadorasPeriodoAnterior(
    tx,
    auditorId,
    objetivo.anio,
    objetivo.mes,
    objetivo.periodo,
    ahora,
  );

  if (bloqueadoras.length > 0) {
    const payload = construirPayloadBloqueoPeriodoAnterior(prev, bloqueadoras, ahora);
    throw conflicto(
      'Debes terminar tus auditorías pendientes del periodo anterior antes de iniciar las del periodo actual.',
      'AUDITORIAS_PERIODO_ANTERIOR_PENDIENTES',
      payload,
    );
  }

  return objetivo;
};

export const assertObjetivoRealizable = (
  objetivo: ObjetivoConPeriodo & { area?: { id: number; nombre: string; codigo: string } },
  objetivoMasAntiguo: (ObjetivoConPeriodo & {
    area?: { id: number; nombre: string; codigo: string };
    asignacionesAuditoria?: { id: number; reabiertaHasta?: Date | null; auditor?: { id: number; nombre: string } | null }[];
  }) | null,
  ahora = new Date(),
  reabiertaHasta?: Date | null,
) => {
  if (!objetivoEsRealizable(objetivo, ahora, reabiertaHasta)) {
    const detalle = derivarSituacionObjetivo(objetivo, ahora);
    throw conflicto(`El periodo no esta disponible para captura: ${detalle.situacion}`);
  }
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
