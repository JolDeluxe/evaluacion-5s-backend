import type { PrismaTransaction } from '../../db';
import { env } from '../../config/env';
import { TipoArea } from '../../generated/prisma/enums';
import { noEncontrado, prohibido, solicitudInvalida } from '../../utils/errores';
import { obtenerAreaIdsConDetalle, tieneDetalleDeArea } from '../../utils/areas_permitidas';
import { puedeAdministrar5S } from '../../utils/permisos';
import { calcularCierreConGracia, derivarSituacionObjetivo, SituacionObjetivo } from '../../utils/periodos';
import { promedio } from './helper';
import { areaEsAuditableEnPeriodo } from '../areas/servicio_vigencia_area';
import { parsearRangoQuery, obtenerResultadosRangoGeneral } from './rpt_rango_helper';

const MESES = [
  'Enero',
  'Febrero',
  'Marzo',
  'Abril',
  'Mayo',
  'Junio',
  'Julio',
  'Agosto',
  'Septiembre',
  'Octubre',
  'Noviembre',
  'Diciembre',
];

type AutenticacionResultados = {
  usuarioId: number;
  rol: import('../../generated/prisma/enums').RolUsuario;
} | undefined;

type QueryMes = {
  mes?: unknown;
  anio?: unknown;
  tipoArea?: unknown;
};

export const obtenerMesResultados = (query: QueryMes) => {
  const ahora = new Date();
  const rawMes = Array.isArray(query.mes) ? query.mes[0] : query.mes;
  const rawAnio = Array.isArray(query.anio) ? query.anio[0] : query.anio;

  if (typeof rawMes === 'string' && /^\d{4}-\d{2}$/.test(rawMes)) {
    const [anioTexto, mesTexto] = rawMes.split('-');
    const anio = Number(anioTexto);
    const mes = Number(mesTexto);
    if (anio < 2020 || anio > 2100 || mes < 1 || mes > 12) {
      throw solicitudInvalida('El mes debe tener formato YYYY-MM valido');
    }
    return {
      anio,
      mes,
      clave: rawMes,
      etiqueta: `${MESES[mes - 1]} ${anio}`,
    };
  }

  if (rawMes !== undefined && String(rawMes).includes('-')) {
    throw solicitudInvalida('El mes debe tener formato YYYY-MM valido');
  }

  const anio = rawAnio === undefined ? ahora.getFullYear() : Number(rawAnio);
  const mes = rawMes === undefined ? ahora.getMonth() + 1 : Number(rawMes);

  if (!Number.isInteger(anio) || anio < 2020 || anio > 2100 || !Number.isInteger(mes) || mes < 1 || mes > 12) {
    throw solicitudInvalida('El mes debe tener formato YYYY-MM valido');
  }

  return {
    anio,
    mes,
    clave: `${anio}-${String(mes).padStart(2, '0')}`,
    etiqueta: `${MESES[mes - 1]} ${anio}`,
  };
};

export const obtenerTipoArea = (query: QueryMes) => {
  if (!query.tipoArea) return undefined;
  const raw = Array.isArray(query.tipoArea) ? query.tipoArea[0] : query.tipoArea;
  if (raw === TipoArea.ADMINISTRATIVA || raw === TipoArea.OPERATIVA) return raw;
  throw solicitudInvalida('tipoArea no es valido');
};

const construirUrlCloudinary = (publicIdCloudinary: string) => (
  `https://res.cloudinary.com/${env.CLOUDINARY_CLOUD_NAME ?? ''}/image/upload/${publicIdCloudinary}`
);

const sumarImagenes = (respuestas: { fotosAuditoria?: unknown[] }[] = []) => (
  respuestas.reduce((total, respuesta) => total + (respuesta.fotosAuditoria?.length ?? 0), 0)
);

const contarHallazgos = (respuestas: { cumple: boolean }[] = []) => (
  respuestas.filter((respuesta) => !respuesta.cumple).length
);

const envioValido = <T extends { invalidadoEn: Date | null }>(envio: T | null | undefined) => (
  envio && !envio.invalidadoEn ? envio : null
);

const construirPeriodoVacio = (periodo: number, referencia?: { terminaEn: Date }) => {
  let situacion: SituacionObjetivo = SituacionObjetivo.PENDIENTE;
  let estado = 'PENDIENTE';

  if (referencia) {
    const ahora = new Date();
    const cierreGracia = calcularCierreConGracia(referencia.terminaEn);

    if (ahora > cierreGracia) {
      situacion = SituacionObjetivo.NO_REALIZADA;
      estado = 'NO_REALIZADA';
    } else if (ahora > referencia.terminaEn) {
      situacion = SituacionObjetivo.ATRASADA_EN_GRACIA;
      estado = 'ATRASADA';
    }
  }

  return {
    periodo,
    completado: false,
    estado,
    situacion,
    porcentaje: null,
    puntosObtenidos: null,
    puntosPosibles: null,
    hallazgos: 0,
    imagenes: 0,
    finalizadoEn: null,
    recibidoEn: null,
    envioResultadoId: null,
  };
};

type ObjetivoConAreaOpcional = Omit<Awaited<ReturnType<typeof obtenerObjetivosMes>>[number], 'area'> & {
  area?: { activo: boolean; auditableDesde: Date | null; auditableHasta: Date | null } | null;
};

export const construirPeriodoResumen = (
  objetivo: ObjetivoConAreaOpcional | undefined,
  periodo: number,
  referencia?: { terminaEn: Date },
) => {
  if (!objetivo) return construirPeriodoVacio(periodo, referencia);

  const situacion = derivarSituacionObjetivo(objetivo);
  const envio = envioValido(objetivo.envioResultado);
  if (!envio) {
    const objConArea = objetivo as typeof objetivo & { area?: { activo: boolean; auditableDesde: Date | null; auditableHasta: Date | null } };
    const esNoAplica = Boolean(
      objetivo.canceladoEn ||
      (objConArea.area && !areaEsAuditableEnPeriodo(objConArea.area, objetivo.anio, objetivo.mes, objetivo.terminaEn.getDate()))
    );

    let estadoPeriodo = 'PENDIENTE';
    let situacionPeriodo: string = situacion.situacion;

    if (esNoAplica) {
      estadoPeriodo = 'NO_APLICA';
      situacionPeriodo = 'NO_APLICA';
    } else if (situacion.situacion === SituacionObjetivo.ATRASADA_EN_GRACIA) {
      estadoPeriodo = 'ATRASADA';
    } else if (situacion.situacion === SituacionObjetivo.NO_REALIZADA) {
      estadoPeriodo = 'NO_REALIZADA';
    }
    return {
      ...construirPeriodoVacio(periodo, objetivo),
      objetivoAuditoriaId: objetivo.id,
      situacion: situacionPeriodo,
      estado: estadoPeriodo,
      cierreGracia: situacion.cierreGracia,
    };
  }

  return {
    periodo,
    objetivoAuditoriaId: objetivo.id,
    completado: true,
    porcentaje: Number(envio.porcentaje),
    puntosObtenidos: Number(envio.puntajeObtenido),
    puntosPosibles: Number(envio.puntajePosible),
    hallazgos: contarHallazgos(envio.respuestasAuditoria),
    imagenes: sumarImagenes(envio.respuestasAuditoria),
    finalizadoEn: envio.finalizadoEn,
    recibidoEn: envio.recibidoEn,
    envioResultadoId: envio.id,
    situacion: situacion.situacion,
    estado: 'REALIZADA',
    cierreGracia: situacion.cierreGracia,
  };
};

export const construirResultadoMensualCanonico = (periodos: ReturnType<typeof construirPeriodoResumen>[]) => {
  const p1 = periodos.find((p) => p.periodo === 1);
  const p2 = periodos.find((p) => p.periodo === 2);

  const p1Realizado = Boolean(p1?.completado && p1?.porcentaje !== null && p1?.porcentaje !== undefined);
  const p2Realizado = Boolean(p2?.completado && p2?.porcentaje !== null && p2?.porcentaje !== undefined);

  if (p1Realizado && p2Realizado) {
    return promedio([p1!.porcentaje!, p2!.porcentaje!]);
  }
  if (p1Realizado && (p2?.estado === 'NO_REALIZADA' || p2?.estado === 'NO_APLICA')) {
    return p1!.porcentaje!;
  }
  if (p2Realizado && (p1?.estado === 'NO_REALIZADA' || p1?.estado === 'NO_APLICA')) {
    return p2!.porcentaje!;
  }

  return null;
};

const construirEstadoArea = (periodos: ReturnType<typeof construirPeriodoResumen>[]) => {
  const todosNoAplica = periodos.every((periodo) => periodo.estado === 'NO_APLICA');
  if (todosNoAplica) return 'NO_APLICA';

  const todosRealizados = periodos.every((periodo) => periodo.completado || periodo.estado === 'REALIZADA' || periodo.estado === 'NO_APLICA');
  if (todosRealizados && periodos.some((p) => p.completado || p.estado === 'REALIZADA')) return 'REALIZADA';

  const algunoRealizado = periodos.some((periodo) => periodo.completado || periodo.estado === 'REALIZADA');
  const todosNoRealizados = periodos.every((periodo) => periodo.estado === 'NO_REALIZADA' || periodo.estado === 'NO_APLICA');
  const algunoNoRealizado = periodos.some((periodo) => periodo.estado === 'NO_REALIZADA');

  if (todosNoRealizados && algunoNoRealizado) return 'NO_REALIZADA';
  if (algunoNoRealizado && algunoRealizado) return 'INCOMPLETA';
  return 'PENDIENTE';
};

const obtenerAreaIdsPropias = async (
  tx: PrismaTransaction,
  autenticacion: AutenticacionResultados,
) => {
  if (!autenticacion) return [];
  const relaciones = await tx.usuarioArea.findMany({
    where: { usuarioId: autenticacion.usuarioId },
    select: { areaId: true },
  });
  return relaciones.map((relacion) => relacion.areaId);
};

const construirAreaDto = (
  areaId: number,
  objetivosArea: Awaited<ReturnType<typeof obtenerObjetivosMes>>,
  areaIdsPropias: number[] = [],
) => {
  const base = objetivosArea[0];
  const periodos = [1, 2].map((periodo) => {
    const obj = objetivosArea.find((objetivo) => objetivo.periodo === periodo);
    const referencia = obj ?? objetivosArea.find(Boolean);
    return construirPeriodoResumen(obj, periodo, referencia);
  });

  const resultadoMensual = construirResultadoMensualCanonico(periodos);

  return {
    area: {
      id: areaId,
      codigo: base?.codigoAreaSnapshot ?? '',
      nombre: base?.nombreAreaSnapshot ?? '',
      tipo: base?.tipoAreaSnapshot ?? null,
      esPropia: areaIdsPropias.includes(areaId),
    },
    resultadoMensual,
    periodos,
    estadoMes: construirEstadoArea(periodos),
  };
};

const obtenerCierreMes = (objetivos: Awaited<ReturnType<typeof obtenerObjetivosMes>>) => {
  if (!objetivos.length) return null;
  const terminaEn = objetivos.reduce((latest, objetivo) => (
    objetivo.terminaEn > latest ? objetivo.terminaEn : latest
  ), objetivos[0].terminaEn);

  return {
    terminaEn,
    cierreGracia: calcularCierreConGracia(terminaEn),
  };
};

const construirEstadoMes = (
  objetivos: Awaited<ReturnType<typeof obtenerObjetivosMes>>,
  periodosCompletados: number,
  periodosProgramados: number,
) => {
  const cierre = obtenerCierreMes(objetivos);
  const ahora = new Date();
  const todosCompletos = periodosProgramados > 0 && periodosCompletados >= periodosProgramados;

  if (!cierre) {
    return {
      estado: 'SIN_PROGRAMACION',
      etiqueta: 'Sin programación',
      consolidado: false,
      mostrarResultado: false,
      mensajeResultado: 'No hay auditorías programadas para este mes',
      terminaEn: null,
      cierreGracia: null,
    };
  }

  if (todosCompletos || ahora > cierre.cierreGracia) {
    return {
      estado: 'CONSOLIDADO',
      etiqueta: 'Consolidado',
      consolidado: true,
      mostrarResultado: true,
      mensajeResultado: null,
      ...cierre,
    };
  }

  return {
    estado: 'EN_CURSO',
    etiqueta: 'En curso',
    consolidado: false,
    mostrarResultado: true,
    mensajeResultado: 'Resultados parciales en tiempo real',
    ...cierre,
  };
};

const construirIncidenciasPorTipo = (
  objetivos: Awaited<ReturnType<typeof obtenerObjetivosMes>>,
) => {
  const porTipo = {
    [TipoArea.ADMINISTRATIVA]: new Map<number, {
    preguntaId: number;
    pregunta: string;
    seccion: string;
      areasEvaluadas: Set<number>;
      areasAfectadas: Set<number>;
    ocurrencias: number;
    }>(),
    [TipoArea.OPERATIVA]: new Map<number, {
      preguntaId: number;
      pregunta: string;
      seccion: string;
      areasEvaluadas: Set<number>;
      areasAfectadas: Set<number>;
      ocurrencias: number;
    }>(),
  };

  for (const objetivo of objetivos) {
    const envio = envioValido(objetivo.envioResultado);
    if (!envio) continue;
    const incidencias = porTipo[objetivo.tipoAreaSnapshot];

    for (const respuesta of envio.respuestasAuditoria) {
      const pregunta = respuesta.preguntaFormulario;
      const actual = incidencias.get(pregunta.id) ?? {
        preguntaId: pregunta.id,
        pregunta: pregunta.texto,
        seccion: pregunta.seccionFormulario.nombre,
        areasEvaluadas: new Set<number>(),
        areasAfectadas: new Set<number>(),
        ocurrencias: 0,
      };
      actual.areasEvaluadas.add(objetivo.areaId);
      if (!respuesta.cumple) {
        actual.areasAfectadas.add(objetivo.areaId);
        actual.ocurrencias += 1;
      }
      incidencias.set(pregunta.id, actual);
    }
  }

  type MapIncidencias = (typeof porTipo)[typeof TipoArea.ADMINISTRATIVA];
  const mapear = (incidencias: MapIncidencias) => (
    [...incidencias.values()]
      .filter((incidencia) => incidencia.areasAfectadas.size > 0)
      .map((incidencia) => ({
        preguntaId: incidencia.preguntaId,
        pregunta: incidencia.pregunta,
        seccion: incidencia.seccion,
        areasAfectadas: incidencia.areasAfectadas.size,
        areasEvaluadas: incidencia.areasEvaluadas.size,
        ocurrencias: incidencia.ocurrencias,
        porcentajeAreas: incidencia.areasEvaluadas.size
          ? (incidencia.areasAfectadas.size / incidencia.areasEvaluadas.size) * 100
          : 0,
      }))
      .sort((a, b) => {
        const porPorcentaje = b.porcentajeAreas - a.porcentajeAreas;
        if (porPorcentaje !== 0) return porPorcentaje;
        const porAreas = b.areasAfectadas - a.areasAfectadas;
        if (porAreas !== 0) return porAreas;
        return b.ocurrencias - a.ocurrencias;
      })
      .slice(0, 5)
  );

  return {
    administrativo: mapear(porTipo[TipoArea.ADMINISTRATIVA]),
    operativo: mapear(porTipo[TipoArea.OPERATIVA]),
  };
};

const obtenerObjetivosMes = async (
  tx: PrismaTransaction,
  autenticacion: AutenticacionResultados,
  filtros: { anio: number; mes: number; tipoArea?: TipoArea },
) => {
  const areaIdsDetalle = await obtenerAreaIdsConDetalle(tx, autenticacion);

  return tx.objetivoAuditoria.findMany({
    where: {
      ...(areaIdsDetalle === null ? {} : { areaId: { in: areaIdsDetalle } }),
      ...(filtros.tipoArea ? { tipoAreaSnapshot: filtros.tipoArea } : {}),
      anio: filtros.anio,
      mes: filtros.mes,
      periodo: { in: [1, 2] },
    },
    include: {
      area: {
        select: {
          activo: true,
          auditableDesde: true,
          auditableHasta: true,
        },
      },
      envioResultado: {
        include: {
          respuestasAuditoria: {
            select: {
              id: true,
              cumple: true,
              preguntaFormulario: {
                select: {
                  id: true,
                  texto: true,
                  seccionFormulario: {
                    select: {
                      id: true,
                      nombre: true,
                    },
                  },
                },
              },
              fotosAuditoria: { select: { id: true } },
            },
          },
        },
      },
    },
    orderBy: [
      { nombreAreaSnapshot: 'asc' },
      { periodo: 'asc' },
    ],
  });
};

export const obtenerResultadosAreas = async (
  tx: PrismaTransaction,
  autenticacion: AutenticacionResultados,
  query: QueryMes,
) => {
  const mes = obtenerMesResultados(query);
  const tipoArea = obtenerTipoArea(query);
  const objetivos = await obtenerObjetivosMes(tx, autenticacion, { ...mes, tipoArea });
  const areaIdsPropias = await obtenerAreaIdsPropias(tx, autenticacion);
  const objetivosPorArea = new Map<number, typeof objetivos>();

  for (const objetivo of objetivos) {
    const actuales = objetivosPorArea.get(objetivo.areaId) ?? [];
    actuales.push(objetivo);
    objetivosPorArea.set(objetivo.areaId, actuales);
  }

  const areas = [...objetivosPorArea.entries()]
    .map(([areaId, objetivosArea]) => construirAreaDto(areaId, objetivosArea, areaIdsPropias))
    .sort((a, b) => {
      const resultadoA = a.resultadoMensual ?? -1;
      const resultadoB = b.resultadoMensual ?? -1;
      const porResultado = resultadoB - resultadoA;
      if (porResultado !== 0) return porResultado;

      const realA = a.periodos.filter((p) => p.completado).length;
      const realB = b.periodos.filter((p) => p.completado).length;
      const porRealizados = realB - realA;
      if (porRealizados !== 0) return porRealizados;

      return a.area.nombre.localeCompare(b.area.nombre, 'es');
    });

  const periodos = areas.flatMap((area) => area.periodos);
  const periodosCompletados = periodos.filter((periodo) => periodo.completado);
  const periodosProgramados = periodos.length;
  const areasRealizadas = areas.filter((area) => area.estadoMes === 'REALIZADA').length;
  const areasPendientes = areas.filter((area) => area.estadoMes === 'PENDIENTE').length;
  const areasIncompletas = areas.filter((area) => area.estadoMes === 'INCOMPLETA').length;
  const areasNoRealizadas = areas.filter((area) => area.estadoMes === 'NO_REALIZADA').length;
  const periodosNoRealizados = periodos.filter((periodo) => periodo.estado === 'NO_REALIZADA').length;
  const estadoMes = construirEstadoMes(objetivos, periodosCompletados.length, periodosProgramados);

  return {
    mes,
    alcance: puedeAdministrar5S(autenticacion?.rol) ? 'GENERAL' : 'MIS_AREAS',
    puedeVerGeneral: puedeAdministrar5S(autenticacion?.rol),
    areas,
    estadoMes,
    resumen: {
      totalAreas: areas.length,
      areasConResultado: areas.filter((area) => area.resultadoMensual !== null).length,
      areasRealizadas,
      areasPendientes,
      areasIncompletas,
      areasNoRealizadas,
      periodosProgramados,
      periodosCompletados: periodosCompletados.length,
      periodosPendientes: Math.max(periodosProgramados - periodosCompletados.length, 0),
      periodosNoRealizados,
      avanceMes: periodosProgramados ? (periodosCompletados.length / periodosProgramados) * 100 : 0,
      hallazgos: periodos.reduce((total, periodo) => total + periodo.hallazgos, 0),
      imagenes: periodos.reduce((total, periodo) => total + periodo.imagenes, 0),
    },
  };
};

const obtenerConjuntoElegibleRanking = (
  areas: Awaited<ReturnType<typeof obtenerResultadosAreas>>['areas'],
  tipo: TipoArea,
) => {
  const deTipo = areas.filter((a) => a.area.tipo === tipo);

  // Prioridad 1: Áreas con 2 periodos completados
  const con2 = deTipo.filter(
    (area) => area.periodos.length >= 2 && area.periodos.every((p) => p.completado),
  );

  if (con2.length > 0) {
    return {
      elegibles: con2.map((area) => ({
        area,
        resultado: area.resultadoMensual as number,
        esProvisional: false,
      })),
      rankingProvisional: false,
      periodosRequeridos: 2,
    };
  }

  // Prioridad 2: Áreas con al menos 1 periodo completado (resultado parcial provisional)
  const con1 = deTipo
    .map((area) => {
      const periodoCompletado = area.periodos.find((p) => p.completado && p.porcentaje !== null);
      if (!periodoCompletado) return null;
      return {
        area,
        resultado: Number(periodoCompletado.porcentaje),
        esProvisional: true,
      };
    })
    .filter(
      (item): item is { area: typeof deTipo[number]; resultado: number; esProvisional: boolean } =>
        item !== null,
    );

  if (con1.length > 0) {
    return {
      elegibles: con1,
      rankingProvisional: true,
      periodosRequeridos: 1,
    };
  }

  return {
    elegibles: [],
    rankingProvisional: false,
    periodosRequeridos: 0,
  };
};

const construirGanadoresPorTipo = (areas: Awaited<ReturnType<typeof obtenerResultadosAreas>>['areas']) => {
  const porTipo = (tipo: TipoArea) => {
    const { elegibles, rankingProvisional, periodosRequeridos } = obtenerConjuntoElegibleRanking(areas, tipo);

    if (!elegibles.length) {
      return { resultado: null, areas: [], rankingProvisional: false, periodosRequeridos: 0 };
    }

    const calculados = elegibles.map(({ area, resultado }) => {
      const p1 = area.periodos.find((p) => p.periodo === 1)?.porcentaje ?? 0;
      const p2 = area.periodos.find((p) => p.periodo === 2)?.porcentaje ?? 0;
      return {
        id: area.area.id,
        nombre: area.area.nombre,
        resultado,
        mejora: p2 - p1,
      };
    });

    let maxResultado = -Infinity;
    for (const c of calculados) {
      if (c.resultado > maxResultado) {
        maxResultado = c.resultado;
      }
    }

    const mejoresPorResultado = calculados.filter(
      (c) => Math.abs(c.resultado - maxResultado) < 1e-9,
    );

    let maxMejora = -Infinity;
    for (const c of mejoresPorResultado) {
      if (c.mejora > maxMejora) {
        maxMejora = c.mejora;
      }
    }

    const coGanadores = mejoresPorResultado.filter(
      (c) => Math.abs(c.mejora - maxMejora) < 1e-9,
    );

    coGanadores.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));

    return {
      resultado: maxResultado,
      areas: coGanadores.map((g) => ({ id: g.id, nombre: g.nombre })),
      rankingProvisional,
      periodosRequeridos,
    };
  };

  return {
    administrativo: porTipo(TipoArea.ADMINISTRATIVA),
    operativo: porTipo(TipoArea.OPERATIVA),
  };
};

const construirPeoresPorTipo = (areas: Awaited<ReturnType<typeof obtenerResultadosAreas>>['areas']) => {
  const porTipo = (tipo: TipoArea) => {
    const { elegibles, rankingProvisional, periodosRequeridos } = obtenerConjuntoElegibleRanking(areas, tipo);

    if (!elegibles.length) {
      return { resultado: null, areas: [], rankingProvisional: false, periodosRequeridos: 0 };
    }

    let minResultado = Infinity;
    for (const item of elegibles) {
      if (item.resultado < minResultado) {
        minResultado = item.resultado;
      }
    }

    const peoresPorResultado = elegibles.filter(
      (item) => Math.abs(item.resultado - minResultado) < 1e-9,
    );

    peoresPorResultado.sort((a, b) => a.area.area.nombre.localeCompare(b.area.area.nombre, 'es'));

    return {
      resultado: minResultado,
      areas: peoresPorResultado.map((p) => ({ id: p.area.area.id, nombre: p.area.area.nombre })),
      rankingProvisional,
      periodosRequeridos,
    };
  };

  return {
    administrativo: porTipo(TipoArea.ADMINISTRATIVA),
    operativo: porTipo(TipoArea.OPERATIVA),
  };
};

export const obtenerResultadosGeneral = async (
  tx: PrismaTransaction,
  autenticacion: AutenticacionResultados,
  query: QueryMes & { tipo?: string; trimestre?: unknown; semestre?: unknown },
) => {
  if (!puedeAdministrar5S(autenticacion?.rol)) {
    throw prohibido('No tienes permiso para consultar el resultado general');
  }

  const rango = parsearRangoQuery(query);
  if (rango.tipo !== 'mes') {
    return obtenerResultadosRangoGeneral(tx, autenticacion, query);
  }

  const data = await obtenerResultadosAreas(tx, autenticacion, query);
  const porcentajesPeriodo = data.areas.flatMap((area) => (
    area.periodos.flatMap((periodo) => (periodo.porcentaje === null ? [] : [periodo.porcentaje]))
  ));
  const objetivos = await obtenerObjetivosMes(tx, autenticacion, { ...data.mes, tipoArea: obtenerTipoArea(query) });
  const porPeriodo = [1, 2].map((periodo) => {
    const periodos = data.areas.map((area) => area.periodos.find((p) => p.periodo === periodo)).filter(Boolean);
    const completados = periodos.filter((p) => p?.completado);
    const porcentajes = periodos.flatMap((p) => (p?.porcentaje === null || p?.porcentaje === undefined ? [] : [p.porcentaje]));
    return {
      periodo,
      completados: completados.length,
      total: periodos.length,
      porcentaje: porcentajes.length ? promedio(porcentajes) : null,
    };
  });

  return {
    ...data,
    tipoRango: 'mes',
    rango,
    resultadoGeneral: data.estadoMes.mostrarResultado && porcentajesPeriodo.length ? promedio(porcentajesPeriodo) : null,
    porPeriodo,
    incidenciasPorTipo: construirIncidenciasPorTipo(objetivos),
    ganadoresPorTipo: data.estadoMes.mostrarResultado
      ? construirGanadoresPorTipo(data.areas)
      : { administrativo: { resultado: null, areas: [] }, operativo: { resultado: null, areas: [] } },
    mensajeGanadores: data.estadoMes.mostrarResultado ? null : 'Los ganadores se definirán al cierre del mes.',
    peoresPorTipo: data.estadoMes.mostrarResultado
      ? construirPeoresPorTipo(data.areas)
      : { administrativo: { resultado: null, areas: [] }, operativo: { resultado: null, areas: [] } },
    mensajePeores: data.estadoMes.mostrarResultado ? null : 'Los resultados se definirán al cierre del mes.',
  };
};

export const obtenerResultadoArea = async (
  tx: PrismaTransaction,
  autenticacion: AutenticacionResultados,
  areaId: number,
  query: QueryMes,
) => {
  const puedeVerDetalle = await tieneDetalleDeArea(tx, autenticacion, areaId);
  if (!puedeVerDetalle) throw prohibido('No tienes permiso para consultar esta area');

  const area = await tx.area.findUnique({ where: { id: areaId } });
  if (!area) throw noEncontrado('Area no encontrada');

  const mes = obtenerMesResultados(query);
  const objetivos = await obtenerObjetivosMes(tx, autenticacion, { ...mes });
  const objetivosArea = objetivos.filter((objetivo) => objetivo.areaId === areaId);
  const primerObj = objetivosArea[0];

  const dto = objetivosArea.length
    ? construirAreaDto(areaId, objetivosArea)
    : {
        area: {
          id: area.id,
          codigo: primerObj?.codigoAreaSnapshot ?? area.codigo,
          nombre: primerObj?.nombreAreaSnapshot ?? area.nombre,
          tipo: primerObj?.tipoAreaSnapshot ?? area.tipo,
        },
        resultadoMensual: null,
        periodos: [construirPeriodoVacio(1), construirPeriodoVacio(2)],
      };

  return {
    mes,
    ...dto,
  };
};

export const obtenerResultadoPeriodo = async (
  tx: PrismaTransaction,
  autenticacion: AutenticacionResultados,
  areaId: number,
  periodo: number,
  query: QueryMes,
) => {
  const puedeVerDetalle = await tieneDetalleDeArea(tx, autenticacion, areaId);
  if (!puedeVerDetalle) throw prohibido('No tienes permiso para consultar esta area');

  const area = await tx.area.findUnique({ where: { id: areaId } });
  if (!area) throw noEncontrado('Area no encontrada');

  const mes = obtenerMesResultados(query);
  const objetivo = await tx.objetivoAuditoria.findFirst({
    where: {
      areaId,
      anio: mes.anio,
      mes: mes.mes,
      periodo,
    },
    include: {
      envioResultado: {
        include: {
          respuestasAuditoria: {
            where: { cumple: false },
            include: {
              preguntaFormulario: {
                include: {
                  seccionFormulario: true,
                },
              },
              fotosAuditoria: true,
            },
          },
        },
      },
    },
  });

  const periodoResumen = construirPeriodoResumen(objetivo ?? undefined, periodo);
  const envio = envioValido(objetivo?.envioResultado);
  const hallazgos = envio
    ? envio.respuestasAuditoria.map((respuesta) => ({
        id: respuesta.id,
        seccion: {
          id: respuesta.preguntaFormulario.seccionFormulario.id,
          nombre: respuesta.preguntaFormulario.seccionFormulario.nombre,
          orden: respuesta.preguntaFormulario.seccionFormulario.orden,
        },
        pregunta: {
          id: respuesta.preguntaFormulario.id,
          texto: respuesta.preguntaFormulario.texto,
          orden: respuesta.preguntaFormulario.orden,
        },
        respuesta: 'NO',
        hallazgo: respuesta.hallazgo,
        evidencias: respuesta.fotosAuditoria.map((foto) => ({
          id: foto.id,
          publicIdCloudinary: foto.publicIdCloudinary,
          url: construirUrlCloudinary(foto.publicIdCloudinary),
          ancho: foto.ancho,
          alto: foto.alto,
          formato: foto.formato,
        })),
      }))
    : [];

  hallazgos.sort((a, b) => {
    if (a.seccion.orden !== b.seccion.orden) return a.seccion.orden - b.seccion.orden;
    return a.pregunta.orden - b.pregunta.orden;
  });

  return {
    mes,
    area: {
      id: area.id,
      codigo: area.codigo,
      nombre: area.nombre,
      tipo: area.tipo,
    },
    periodo,
    resultado: periodoResumen,
    hallazgos,
  };
};

export const assertPuedeVerEnvioResultado = async (
  tx: PrismaTransaction,
  autenticacion: AutenticacionResultados,
  envioId: number,
) => {
  const envio = await tx.envioAuditoria.findUnique({
    where: { id: envioId },
    select: { objetivoAuditoria: { select: { areaId: true } } },
  });
  if (!envio) throw noEncontrado('Envio no encontrado');

  const puedeVerDetalle = await tieneDetalleDeArea(tx, autenticacion, envio.objetivoAuditoria.areaId);
  if (!puedeVerDetalle) throw prohibido('No tienes permiso para consultar este resultado');
};
