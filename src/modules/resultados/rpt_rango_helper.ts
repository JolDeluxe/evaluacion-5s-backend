import type { PrismaTransaction } from '../../db';
import { TipoArea } from '../../generated/prisma/enums';
import { solicitudInvalida } from '../../utils/errores';
import { obtenerAreaIdsConDetalle } from '../../utils/areas_permitidas';
import { calcularCierreConGracia } from '../../utils/periodos';
import { promedio } from './helper';
import { construirPeriodoResumen, construirResultadoMensualCanonico } from './servicio';

export type TipoRango = 'mes' | 'trimestre' | 'semestre' | 'anio';

export type QueryRango = {
  tipo?: TipoRango | string | unknown;
  mes?: unknown;
  anio?: number | string | unknown;
  trimestre?: number | string | unknown;
  semestre?: number | string | unknown;
  tipoArea?: unknown;
};

export type MesDef = {
  anio: number;
  mes: number;
  clave: string;
  etiqueta: string;
};

export type RangoDef = {
  tipo: TipoRango;
  anio: number;
  trimestre?: number;
  semestre?: number;
  clave: string;
  etiqueta: string;
  subEtiqueta: string;
  meses: MesDef[];
};

const NOMBRES_MESES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

const ABREV_MESES = [
  'Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun',
  'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic',
];

export function construirMesDef(anio: number, mes: number): MesDef {
  const clave = `${anio}-${String(mes).padStart(2, '0')}`;
  return {
    anio,
    mes,
    clave,
    etiqueta: `${NOMBRES_MESES[mes - 1]} ${anio}`,
  };
}

export function parsearRangoQuery(query: QueryRango): RangoDef {
  const ahora = new Date();
  const anioActual = ahora.getFullYear();
  const mesActual = ahora.getMonth() + 1;

  let tipo: TipoRango = 'mes';
  if (query.tipo && ['mes', 'trimestre', 'semestre', 'anio'].includes(String(query.tipo))) {
    tipo = query.tipo as TipoRango;
  } else if (query.mes && String(query.mes).includes('-')) {
    tipo = 'mes';
  }

  if (tipo === 'mes') {
    let anio = anioActual;
    let mes = mesActual;

    if (query.mes && typeof query.mes === 'string' && /^\d{4}-\d{2}$/.test(query.mes)) {
      const [a, m] = query.mes.split('-').map(Number);
      anio = a;
      mes = m;
    } else if (query.anio || query.mes) {
      if (query.anio) anio = Number(query.anio);
      if (query.mes) mes = Number(query.mes);
    }

    if (!Number.isInteger(anio) || anio < 2020 || anio > 2100 || !Number.isInteger(mes) || mes < 1 || mes > 12) {
      throw solicitudInvalida('El mes debe tener formato YYYY-MM válido');
    }

    const mesDef = construirMesDef(anio, mes);
    return {
      tipo: 'mes',
      anio,
      clave: mesDef.clave,
      etiqueta: mesDef.etiqueta,
      subEtiqueta: NOMBRES_MESES[mes - 1],
      meses: [mesDef],
    };
  }

  const anio = query.anio ? Number(query.anio) : anioActual;
  if (!Number.isInteger(anio) || anio < 2020 || anio > 2100) {
    throw solicitudInvalida('El año no es válido');
  }

  if (tipo === 'trimestre') {
    const tri = query.trimestre ? Number(query.trimestre) : Math.ceil(mesActual / 3);
    if (!Number.isInteger(tri) || tri < 1 || tri > 4) {
      throw solicitudInvalida('El trimestre debe ser entre 1 y 4');
    }
    const mesInicio = (tri - 1) * 3 + 1;
    const meses = [0, 1, 2].map((off) => construirMesDef(anio, mesInicio + off));
    const subEtiqueta = `${NOMBRES_MESES[mesInicio - 1]} - ${NOMBRES_MESES[mesInicio + 1]}`;

    return {
      tipo: 'trimestre',
      anio,
      trimestre: tri,
      clave: `${anio}-Q${tri}`,
      etiqueta: `Trimestre ${tri} · ${anio}`,
      subEtiqueta,
      meses,
    };
  }

  if (tipo === 'semestre') {
    const sem = query.semestre ? Number(query.semestre) : (mesActual <= 6 ? 1 : 2);
    if (!Number.isInteger(sem) || sem < 1 || sem > 2) {
      throw solicitudInvalida('El semestre debe ser 1 o 2');
    }
    const mesInicio = (sem - 1) * 6 + 1;
    const meses = [0, 1, 2, 3, 4, 5].map((off) => construirMesDef(anio, mesInicio + off));
    const subEtiqueta = `${NOMBRES_MESES[mesInicio - 1]} - ${NOMBRES_MESES[mesInicio + 5]}`;

    return {
      tipo: 'semestre',
      anio,
      semestre: sem,
      clave: `${anio}-H${sem}`,
      etiqueta: `Semestre ${sem} · ${anio}`,
      subEtiqueta,
      meses,
    };
  }

  // tipo === 'anio'
  const meses = Array.from({ length: 12 }, (_, i) => construirMesDef(anio, i + 1));
  return {
    tipo: 'anio',
    anio,
    clave: `${anio}`,
    etiqueta: `Año ${anio}`,
    subEtiqueta: 'Enero - Diciembre',
    meses,
  };
}

export type AutenticacionResultados = {
  usuarioId: number;
  rol: import('../../generated/prisma/enums').RolUsuario;
} | undefined;

export async function obtenerResultadosRangoGeneral(
  tx: PrismaTransaction,
  autenticacion: AutenticacionResultados,
  query: QueryRango,
) {
  const rango = parsearRangoQuery(query);
  const tipoAreaFilter = (query.tipoArea && [TipoArea.ADMINISTRATIVA, TipoArea.OPERATIVA].includes(query.tipoArea as TipoArea))
    ? (query.tipoArea as TipoArea)
    : undefined;

  const areaIdsDetalle = await obtenerAreaIdsConDetalle(tx, autenticacion);

  // Cargar todos los objetivosAuditoria dentro de los meses del rango
  const objetivosRango = await tx.objetivoAuditoria.findMany({
    where: {
      ...(areaIdsDetalle === null ? {} : { areaId: { in: areaIdsDetalle } }),
      ...(tipoAreaFilter ? { tipoAreaSnapshot: tipoAreaFilter } : {}),
      anio: rango.anio,
      mes: { in: rango.meses.map((m) => m.mes) },
      periodo: { in: [1, 2] },
    },
    include: {
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
      { mes: 'asc' },
      { periodo: 'asc' },
    ],
  });

  const ahora = new Date();

  // Determinar estado de cada mes del rango
  const estadosMesMap = new Map<string, {
    consolidado: boolean;
    enCurso: boolean;
    futuro: boolean;
    mostrarResultado: boolean;
    terminaEn: Date | null;
    cierreGracia: Date | null;
  }>();

  function primerDiaMesEsFuturo(anio: number, mes: number, ahoraRef: Date) {
    const primerDia = new Date(anio, mes - 1, 1);
    return primerDia > ahoraRef;
  }

  for (const mDef of rango.meses) {
    const objsMes = objetivosRango.filter((o) => o.mes === mDef.mes);
    if (!objsMes.length) {
      // Si el mes es futuro respecto al presente
      const primerDiaMes = new Date(mDef.anio, mDef.mes - 1, 1);
      const futuro = primerDiaMes > ahora;
      estadosMesMap.set(mDef.clave, {
        consolidado: false,
        enCurso: !futuro,
        futuro,
        mostrarResultado: false,
        terminaEn: null,
        cierreGracia: null,
      });
      continue;
    }

    const terminaEn = objsMes.reduce((latest, obj) => (
      obj.terminaEn > latest ? obj.terminaEn : latest
    ), objsMes[0].terminaEn);
    const cierreGracia = calcularCierreConGracia(terminaEn);

    const programados = objsMes.length;
    const completados = objsMes.filter((o) => o.envioResultado && !o.envioResultado.invalidadoEn).length;

    const consolidado = (programados > 0 && completados >= programados) || ahora > cierreGracia;
    const enCurso = !consolidado && ahora <= cierreGracia;
    const futuro = primerDiaMesEsFuturo(mDef.anio, mDef.mes, ahora);

    estadosMesMap.set(mDef.clave, {
      consolidado,
      enCurso,
      futuro,
      mostrarResultado: consolidado,
      terminaEn,
      cierreGracia,
    });
  }

  // Agrupar objetivos por área
  type ObjetivoElement = typeof objetivosRango[number];
  const objetivosPorArea = new Map<number, {
    areaId: number;
    codigo: string;
    nombre: string;
    tipo: TipoArea;
    objetivos: ObjetivoElement[];
  }>();

  for (const obj of objetivosRango) {
    const actual = objetivosPorArea.get(obj.areaId) ?? {
      areaId: obj.areaId,
      codigo: obj.codigoAreaSnapshot,
      nombre: obj.nombreAreaSnapshot,
      tipo: obj.tipoAreaSnapshot,
      objetivos: [],
    };
    actual.objetivos.push(obj);
    objetivosPorArea.set(obj.areaId, actual);
  }

  // Mapear áreas y sus resultados mensuales / por periodo
  const areasAgregadas = [...objetivosPorArea.values()].map((areaData) => {
    // Para cada mes del rango, calcular su resultadoMensual canónico
    const mesesDetalle = rango.meses.map((mDef) => {
      const objsMes = areaData.objetivos.filter((o) => o.mes === mDef.mes);
      const periodos = [1, 2].map((periodo) => {
        const obj = objsMes.find((o) => o.periodo === periodo);
        const referencia = obj ?? objsMes.find(Boolean);
        return construirPeriodoResumen(obj, periodo, referencia);
      });

      const resultadoMensual = construirResultadoMensualCanonico(periodos);

      return {
        mes: mDef.mes,
        clave: mDef.clave,
        nombre: NOMBRES_MESES[mDef.mes - 1],
        abrev: ABREV_MESES[mDef.mes - 1],
        resultadoMensual,
        programados: objsMes.length,
        completados: periodos.filter((p) => p.completado).length,
      };
    });

    // Calcular resultado del rango para este área usando los resultados mensuales canónicos válidos
    const resultadosMensualesValidosRango = mesesDetalle
      .map((m) => m.resultadoMensual)
      .filter((r): r is number => r !== null && r !== undefined);

    const resultadoRango = resultadosMensualesValidosRango.length ? promedio(resultadosMensualesValidosRango) : null;

    // Calcular desglose trimestral (promedio de los resultados mensuales canónicos de los 3 meses del trimestre)
    const trimestresDetalle = [1, 2, 3, 4].map((tri) => {
      const mesesTri = [(tri - 1) * 3 + 1, (tri - 1) * 3 + 2, tri * 3];
      const resMesesTri = mesesDetalle
        .filter((m) => mesesTri.includes(m.mes))
        .map((m) => m.resultadoMensual)
        .filter((r): r is number => r !== null && r !== undefined);

      return {
        trimestre: tri,
        resultado: resMesesTri.length ? promedio(resMesesTri) : null,
      };
    });

    // Total auditorías requeridas vs completadas en el rango
    const enviosValidosRango = areaData.objetivos
      .map((o) => (o.envioResultado && !o.envioResultado.invalidadoEn ? o.envioResultado : null))
      .filter(Boolean);
    const auditoriasRequeridas = areaData.objetivos.length;
    const auditoriasCompletadas = enviosValidosRango.length;
    const coberturaPct = auditoriasRequeridas ? (auditoriasCompletadas / auditoriasRequeridas) * 100 : 0;
    const elegible = auditoriasRequeridas > 0 && auditoriasCompletadas >= auditoriasRequeridas;

    return {
      area: {
        id: areaData.areaId,
        codigo: areaData.codigo,
        nombre: areaData.nombre,
        tipo: areaData.tipo,
      },
      resultadoRango,
      mesesDetalle,
      trimestresDetalle,
      auditoriasRequeridas,
      auditoriasCompletadas,
      coberturaPct,
      elegible,
    };
  });

  // Ordenar áreas por resultado del rango
  areasAgregadas.sort((a, b) => {
    const resA = a.resultadoRango ?? -1;
    const resB = b.resultadoRango ?? -1;
    const dif = resB - resA;
    if (dif !== 0) return dif;
    return a.area.nombre.localeCompare(b.area.nombre, 'es');
  });

  // Determinar si el rango completo está consolidado o en curso
  const todosMesesConsolidados = rango.meses.every((m) => estadosMesMap.get(m.clave)?.consolidado);

  let estadoRango: 'CONSOLIDADO' | 'EN_CURSO' | 'SIN_PROGRAMACION' = 'EN_CURSO';
  let etiquetaEstado = 'En curso';
  if (todosMesesConsolidados && objetivosRango.length > 0) {
    estadoRango = 'CONSOLIDADO';
    etiquetaEstado = 'Consolidado';
  } else if (!objetivosRango.length) {
    estadoRango = 'SIN_PROGRAMACION';
    etiquetaEstado = 'Sin programación';
  }

  // Resultado general del rango (promedio de los resultados mensuales canónicos válidos de todas las áreas)
  const todosResultadosMensualesRango = areasAgregadas
    .flatMap((a) => a.mesesDetalle.map((m) => m.resultadoMensual))
    .filter((r): r is number => r !== null && r !== undefined);

  const resultadoGeneralRango = todosResultadosMensualesRango.length ? promedio(todosResultadosMensualesRango) : null;

  // Ganadores y Peores del Rango por Tipo
  const construirGanadoresRango = (tipo: TipoArea) => {
    const elegibles = areasAgregadas.filter((a) => a.area.tipo === tipo && a.elegible && a.resultadoRango !== null);
    if (!elegibles.length) return { resultado: null, areas: [] };

    let maxRes = -Infinity;
    for (const item of elegibles) {
      if (item.resultadoRango! > maxRes) maxRes = item.resultadoRango!;
    }

    const mejores = elegibles.filter((item) => Math.abs(item.resultadoRango! - maxRes) < 1e-9);
    mejores.sort((a, b) => a.area.nombre.localeCompare(b.area.nombre, 'es'));

    return {
      resultado: maxRes,
      areas: mejores.map((m) => ({ id: m.area.id, nombre: m.area.nombre })),
    };
  };

  const construirPeoresRango = (tipo: TipoArea) => {
    const elegibles = areasAgregadas.filter((a) => a.area.tipo === tipo && a.elegible && a.resultadoRango !== null);
    if (!elegibles.length) return { resultado: null, areas: [] };

    let minRes = Infinity;
    for (const item of elegibles) {
      if (item.resultadoRango! < minRes) minRes = item.resultadoRango!;
    }

    const peores = elegibles.filter((item) => Math.abs(item.resultadoRango! - minRes) < 1e-9);
    peores.sort((a, b) => a.area.nombre.localeCompare(b.area.nombre, 'es'));

    return {
      resultado: minRes,
      areas: peores.map((p) => ({ id: p.area.id, nombre: p.area.nombre })),
    };
  };

  // Top Incidencias del Rango
  const porTipoIncidencias = {
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

  for (const obj of objetivosRango) {
    const envio = obj.envioResultado && !obj.envioResultado.invalidadoEn ? obj.envioResultado : null;
    if (!envio) continue;

    const mapInc = porTipoIncidencias[obj.tipoAreaSnapshot];
    for (const resp of envio.respuestasAuditoria) {
      const preg = resp.preguntaFormulario;
      const actual = mapInc.get(preg.id) ?? {
        preguntaId: preg.id,
        pregunta: preg.texto,
        seccion: preg.seccionFormulario.nombre,
        areasEvaluadas: new Set<number>(),
        areasAfectadas: new Set<number>(),
        ocurrencias: 0,
      };
      actual.areasEvaluadas.add(obj.areaId);
      if (!resp.cumple) {
        actual.areasAfectadas.add(obj.areaId);
        actual.ocurrencias += 1;
      }
      mapInc.set(preg.id, actual);
    }
  }

  type MapIncidencias = (typeof porTipoIncidencias)[keyof typeof porTipoIncidencias];
  const mapearIncidencias = (mapInc: MapIncidencias) => (
    [...mapInc.values()]
      .filter((inc) => inc.areasAfectadas.size > 0)
      .map((inc) => ({
        preguntaId: inc.preguntaId,
        pregunta: inc.pregunta,
        seccion: inc.seccion,
        areasAfectadas: inc.areasAfectadas.size,
        areasEvaluadas: inc.areasEvaluadas.size,
        ocurrencias: inc.ocurrencias,
        porcentajeAreas: inc.areasEvaluadas.size ? (inc.areasAfectadas.size / inc.areasEvaluadas.size) * 100 : 0,
      }))
      .sort((a, b) => {
        const difP = b.porcentajeAreas - a.porcentajeAreas;
        if (difP !== 0) return difP;
        const difA = b.areasAfectadas - a.areasAfectadas;
        if (difA !== 0) return difA;
        return b.ocurrencias - a.ocurrencias;
      })
      .slice(0, 5)
  );

  const incidenciasPorTipo = {
    administrativo: mapearIncidencias(porTipoIncidencias[TipoArea.ADMINISTRATIVA]),
    operativo: mapearIncidencias(porTipoIncidencias[TipoArea.OPERATIVA]),
  };

  const mostrarGanadoresPeores = estadoRango === 'CONSOLIDADO';

  return {
    rango,
    estadoRango: {
      estado: estadoRango,
      etiqueta: etiquetaEstado,
      consolidado: estadoRango === 'CONSOLIDADO',
      mostrarResultado: true, // Se muestra el resultado general acumulado a la fecha
    },
    resultadoGeneral: resultadoGeneralRango,
    areas: areasAgregadas,
    incidenciasPorTipo,
    ganadoresPorTipo: mostrarGanadoresPeores
      ? { administrativo: construirGanadoresRango(TipoArea.ADMINISTRATIVA), operativo: construirGanadoresRango(TipoArea.OPERATIVA) }
      : { administrativo: { resultado: null, areas: [] }, operativo: { resultado: null, areas: [] } },
    peoresPorTipo: mostrarGanadoresPeores
      ? { administrativo: construirPeoresRango(TipoArea.ADMINISTRATIVA), operativo: construirPeoresRango(TipoArea.OPERATIVA) }
      : { administrativo: { resultado: null, areas: [] }, operativo: { resultado: null, areas: [] } },
    mensajeGanadores: mostrarGanadoresPeores ? null : 'Los ganadores se definirán al cierre del rango.',
    mensajePeores: mostrarGanadoresPeores ? null : 'Los resultados se definirán al cierre del rango.',
  };
}
