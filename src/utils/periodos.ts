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

export const esDiaHabil = (fecha: Date, diasInhabilesFechas?: Set<string>): boolean => {
  const dia = fecha.getDay();
  if (dia === 0 || dia === 6) return false;
  if (diasInhabilesFechas) {
    const yyyyMMdd = `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, '0')}-${String(fecha.getDate()).padStart(2, '0')}`;
    if (diasInhabilesFechas.has(yyyyMMdd)) return false;
  }
  return true;
};

export const sumarDiasHabiles = (fecha: Date, dias: number, diasInhabilesFechas?: Set<string>) => {
  const resultado = new Date(fecha);
  if (Number.isNaN(resultado.getTime())) return resultado;
  let restantes = dias;

  while (restantes > 0) {
    resultado.setDate(resultado.getDate() + 1);
    if (esDiaHabil(resultado, diasInhabilesFechas)) restantes -= 1;
  }

  return resultado;
};

export const calcularCierreConGracia = (terminaEn: Date, diasInhabilesFechas?: Set<string>) => (
  sumarDiasHabiles(terminaEn, DIAS_HABILES_GRACIA, diasInhabilesFechas)
);

/**
 * Devuelve el primer día hábil del mes (lunes–viernes).
 * Si el día 1 del mes ya es hábil, lo devuelve tal cual.
 * De lo contrario avanza hasta el primer lunes o día hábil.
 * La hora devuelta es 00:00:00.000 del día resultante.
 */
export const primerDiaHabilMes = (anio: number, mes: number, diasInhabilesFechas?: Set<string>): Date => {
  const dia1 = new Date(anio, mes - 1, 1, 0, 0, 0, 0);
  if (esDiaHabil(dia1, diasInhabilesFechas)) return dia1;
  // Avanzar hasta el primer día hábil
  const resultado = new Date(dia1);
  while (!esDiaHabil(resultado, diasInhabilesFechas)) {
    resultado.setDate(resultado.getDate() + 1);
  }
  return resultado;
};

/**
 * Devuelve el mes anterior dado un par anio/mes.
 */
export const mesAnteriorDe = (anio: number, mes: number): { anio: number; mes: number } =>
  mes === 1 ? { anio: anio - 1, mes: 12 } : { anio, mes: mes - 1 };

/**
 * Devuelve el último día hábil menor o igual a la fecha límite natural del periodo.
 * - Para P1: último día hábil <= 15 del mes.
 * - Para P2: último día hábil <= fin de mes.
 * La hora devuelta es 00:00:00.000 del día resultante.
 */
export const obtenerUltimoDiaHabilPeriodo = (
  anio: number,
  mes: number,
  periodo: 1 | 2,
  diasInhabilesFechas?: Set<string>,
): Date => {
  const diaInicio = periodo === 1 ? 15 : new Date(anio, mes, 0).getDate();
  const fecha = new Date(anio, mes - 1, diaInicio, 0, 0, 0, 0);

  while (!esDiaHabil(fecha, diasInhabilesFechas)) {
    fecha.setDate(fecha.getDate() - 1);
  }

  return fecha;
};

/**
 * Obtiene los componentes de fecha/hora en la zona horaria oficial America/Mexico_City.
 */
export const obtenerFechaHoraCDMX = (fecha: Date = new Date()): { yyyyMMdd: string; hora: number } => {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Mexico_City',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hour12: false,
  }).formatToParts(fecha);

  const year = partes.find((p) => p.type === 'year')?.value ?? '1970';
  const month = partes.find((p) => p.type === 'month')?.value ?? '01';
  const day = partes.find((p) => p.type === 'day')?.value ?? '01';
  const hour = Number(partes.find((p) => p.type === 'hour')?.value ?? '0');

  return {
    yyyyMMdd: `${year}-${month}-${day}`,
    hora: hour,
  };
};

/**
 * Evalúa si una fecha actual está dentro de la ventana de recordatorio para un periodo:
 * - Solo ejecutable en la fecha exacta del recordatorio (último día hábil del corte).
 * - A partir de las 09:00 AM (hora CDMX).
 * - Si el día ya pasó, se considera extemporáneo/obsoleto.
 */
export const evaluarVentanaRecordatorioPeriodo = (
  fechaRecordatorio: Date,
  ahora = new Date(),
): { esElegible: boolean; esObsoleto: boolean; motivo: string } => {
  const cdmx = obtenerFechaHoraCDMX(ahora);
  const recordatorioYMD = `${fechaRecordatorio.getFullYear()}-${String(fechaRecordatorio.getMonth() + 1).padStart(2, '0')}-${String(fechaRecordatorio.getDate()).padStart(2, '0')}`;

  if (cdmx.yyyyMMdd < recordatorioYMD) {
    return {
      esElegible: false,
      esObsoleto: false,
      motivo: `Aún no es la fecha del recordatorio (${recordatorioYMD}).`,
    };
  }

  if (cdmx.yyyyMMdd > recordatorioYMD) {
    return {
      esElegible: false,
      esObsoleto: true,
      motivo: `La fecha del recordatorio (${recordatorioYMD}) ya pasó. No se envían recordatorios extemporáneos.`,
    };
  }

  // Mismo día
  if (cdmx.hora < 9) {
    return {
      esElegible: false,
      esObsoleto: false,
      motivo: `El recordatorio se ejecuta a partir de las 09:00 AM (hora CDMX). Hora actual: ${cdmx.hora}:00.`,
    };
  }

  return {
    esElegible: true,
    esObsoleto: false,
    motivo: 'Ventana activa para envío de recordatorio.',
  };
};

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
