import fs from 'fs';
import path from 'path';
import type { PrismaTransaction } from '../../db';
import { prisma } from '../../db';
import { env } from '../../config/env';
import { logger } from '../../app';
import { MESES_NOMBRES } from '../../utils/periodos';
import {
  construirPeriodoResumen,
  construirResultadoMensualCanonico,
} from '../resultados/servicio';

export interface RutasExportacionCsv {
  dir: string;
  rutaResultados: string;
  rutaAtrasos: string;
}

export interface ResultadoSincronizacionCsv {
  rutaResultados: string;
  rutaAtrasos: string;
  totalResultados: number;
  totalAtrasos: number;
  actualizadoEn: Date;
}

/**
 * Obtiene las rutas absolutas configuradas para la exportación de archivos CSV.
 */
export function obtenerRutasCsv(): RutasExportacionCsv {
  if (process.env.NODE_ENV === 'test' && !process.env.CSV_TEST_USAR_PROD) {
    const dir = path.join(process.cwd(), 'tmp', 'test-csv');
    return {
      dir,
      rutaResultados: path.join(dir, 'resultados.csv'),
      rutaAtrasos: path.join(dir, 'atrasos.csv'),
    };
  }
  const dir = env.CSV_EXPORT_DIR || 'H:\\AUDITOR INTERNO\\PRIVADO\\5 Isaac\\Auditorias 5S\\Archivos_APP';
  const rutaResultados = env.CSV_RESULTADOS_PATH || path.join(dir, 'resultados.csv');
  const rutaAtrasos = env.CSV_ATRASOS_PATH || path.join(dir, 'atrasos.csv');
  return { dir, rutaResultados, rutaAtrasos };
}

/**
 * Escapa un valor para formato CSV estándar (RFC 4180).
 */
export function escaparCsv(valor: unknown): string {
  if (valor === null || valor === undefined) return '';
  const str = String(valor).trim();
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Resuelve el RESPONSABLE REAL del área / auditoría.
 * REGLA ESTRICTA: Jamás utilizar el auditor ejecutor, apoyo o usuario que realizó el envío
 * (nombreAuditorSnapshot o enviadoPorUsuario). Siempre identificar la titularidad real.
 */
export function resolverResponsableReal(
  area: {
    usuariosArea?: Array<{ usuario?: { id: number; nombre: string } | null }>;
  },
  asignacionAuditoria?: {
    responsableCumplimiento?: { id: number; nombre: string } | null;
  } | null,
  asignacionMensual?: {
    responsableCumplimiento?: { id: number; nombre: string } | null;
  } | null,
): string {
  if (asignacionAuditoria?.responsableCumplimiento?.nombre) {
    return asignacionAuditoria.responsableCumplimiento.nombre.trim();
  }

  if (asignacionMensual?.responsableCumplimiento?.nombre) {
    return asignacionMensual.responsableCumplimiento.nombre.trim();
  }

  const nombresArea = (area.usuariosArea || [])
    .map((ua) => ua.usuario?.nombre?.trim())
    .filter(Boolean) as string[];

  if (nombresArea.length > 0) {
    return nombresArea.join(' / ');
  }

  return 'Sin Responsable';
}

/**
 * Resuelve el RESPONSABLE de la auditoría (el auditor asignado o que realizó la auditoría).
 * Si nadie estuvo asignado (como en los registros históricos de migración), queda en blanco ("").
 */
export function resolverResponsableAuditoria(
  p1Obj?: {
    envioResultado?: {
      enviadoPorUsuario?: { id?: number; nombre?: string | null } | null;
      nombreAuditorSnapshot?: string | null;
    } | null;
    asignacionesAuditoria?: Array<{
      auditor?: { id?: number; nombre?: string | null } | null;
      estado?: string;
    }>;
  } | null,
  p2Obj?: {
    envioResultado?: {
      enviadoPorUsuario?: { id?: number; nombre?: string | null } | null;
      nombreAuditorSnapshot?: string | null;
    } | null;
    asignacionesAuditoria?: Array<{
      auditor?: { id?: number; nombre?: string | null } | null;
      estado?: string;
    }>;
  } | null,
): string {
  const obtenerAuditorDeObj = (obj?: typeof p1Obj) => {
    if (!obj) return null;
    const envio = obj.envioResultado;
    if (envio?.enviadoPorUsuario?.nombre) {
      return envio.enviadoPorUsuario.nombre.trim();
    }
    if (
      envio?.nombreAuditorSnapshot &&
      !envio.nombreAuditorSnapshot.toUpperCase().includes('HISTÓRICO') &&
      !envio.nombreAuditorSnapshot.toUpperCase().includes('POWER BI') &&
      !envio.nombreAuditorSnapshot.toUpperCase().includes('TALLY')
    ) {
      return envio.nombreAuditorSnapshot.trim();
    }

    const asigActiva = obj.asignacionesAuditoria?.find((a) => a.estado !== 'CANCELADA');
    if (asigActiva?.auditor?.nombre) {
      return asigActiva.auditor.nombre.trim();
    }

    const primeraAsig = obj.asignacionesAuditoria?.[0];
    if (primeraAsig?.auditor?.nombre) {
      return primeraAsig.auditor.nombre.trim();
    }

    return null;
  };

  const aud1 = obtenerAuditorDeObj(p1Obj);
  const aud2 = obtenerAuditorDeObj(p2Obj);

  if (aud1 && aud2) {
    return aud1 === aud2 ? aud1 : `${aud1} / ${aud2}`;
  }
  if (aud1) return aud1;
  if (aud2) return aud2;

  return '';
}

/**
 * Genera el contenido de resultados.csv:
 * Columnas: AÑO, MES, AREA, RESPONSABLE, RESULTADO PRIMER PERIODO, RESULTADO SEGUNDO PERIODO, RESULTADO FINAL
 */
export async function generarResultadosCsvString(
  tx: PrismaTransaction | typeof prisma = prisma,
): Promise<{ contenido: string; totalRegistros: number }> {
  const ahora = new Date();
  const anioActual = ahora.getFullYear();
  const mesActual = ahora.getMonth() + 1;

  // Obtener objetivos de auditoría hasta el año y mes actual
  const objetivos = await tx.objetivoAuditoria.findMany({
    where: {
      OR: [
        { anio: { lt: anioActual } },
        { anio: anioActual, mes: { lte: mesActual } },
      ],
    },
    include: {
      area: true,
      envioResultado: {
        select: {
          id: true,
          porcentaje: true,
          invalidadoEn: true,
          nombreAuditorSnapshot: true,
          enviadoPorUsuario: {
            select: { id: true, nombre: true },
          },
        },
      },
      asignacionesAuditoria: {
        include: {
          auditor: { select: { id: true, nombre: true } },
        },
      },
    },
    orderBy: [
      { anio: 'asc' },
      { mes: 'asc' },
      { nombreAreaSnapshot: 'asc' },
      { periodo: 'asc' },
    ],
  });

  // Obtener asignaciones mensuales para mapear responsabilidades de cumplimiento mensuales
  const asignacionesMensuales = await tx.asignacionMensual.findMany({
    include: {
      responsableCumplimiento: { select: { id: true, nombre: true } },
    },
  });

  const mapaAsigMensual = new Map<string, typeof asignacionesMensuales[number]>();
  for (const am of asignacionesMensuales) {
    mapaAsigMensual.set(`${am.anio}-${am.mes}-${am.areaId}`, am);
  }

  // Agrupar objetivos por año, mes y área
  type GrupoArea = {
    anio: number;
    mes: number;
    areaId: number;
    areaNombre: string;
    area: typeof objetivos[0]['area'];
    p1Obj?: typeof objetivos[0];
    p2Obj?: typeof objetivos[0];
  };

  const gruposPorClave = new Map<string, GrupoArea>();

  for (const obj of objetivos) {
    const clave = `${obj.anio}-${obj.mes}-${obj.areaId}`;
    let grupo = gruposPorClave.get(clave);
    if (!grupo) {
      grupo = {
        anio: obj.anio,
        mes: obj.mes,
        areaId: obj.areaId,
        areaNombre: obj.nombreAreaSnapshot,
        area: obj.area,
      };
      gruposPorClave.set(clave, grupo);
    }
    if (obj.periodo === 1) {
      grupo.p1Obj = obj;
    } else if (obj.periodo === 2) {
      grupo.p2Obj = obj;
    }
  }

  const filas: string[] = [];
  const cabecera = ['AÑO', 'MES', 'AREA', 'RESPONSABLE', 'RESULTADO PRIMER PERIODO', 'RESULTADO SEGUNDO PERIODO', 'RESULTADO FINAL']
    .map(escaparCsv)
    .join(',');
  filas.push(cabecera);

  // Ordenar grupos cronológicamente y alfabéticamente por área
  const gruposOrdenados = Array.from(gruposPorClave.values()).sort((a, b) => {
    if (a.anio !== b.anio) return a.anio - b.anio;
    if (a.mes !== b.mes) return a.mes - b.mes;
    return a.areaNombre.localeCompare(b.areaNombre, 'es');
  });

  for (const g of gruposOrdenados) {
    const responsable = resolverResponsableAuditoria(g.p1Obj, g.p2Obj);

    const objetivosArea = [g.p1Obj, g.p2Obj].filter((o): o is NonNullable<typeof o> => Boolean(o));
    const periodos = [1, 2].map((periodo) => {
      const obj = objetivosArea.find((objetivo) => objetivo.periodo === periodo);
      const referencia = obj ?? objetivosArea.find(Boolean) ?? { terminaEn: new Date(g.anio, g.mes, 0, 23, 59, 59, 999) };
      return construirPeriodoResumen(obj as any, periodo, referencia);
    });

    const resultadoMensual = construirResultadoMensualCanonico(periodos);

    const p1 = periodos.find((p) => p.periodo === 1);
    const p2 = periodos.find((p) => p.periodo === 2);

    const p1Texto = p1?.completado && p1?.porcentaje !== null && p1?.porcentaje !== undefined
      ? Number(p1.porcentaje).toFixed(2)
      : '';
    const p2Texto = p2?.completado && p2?.porcentaje !== null && p2?.porcentaje !== undefined
      ? Number(p2.porcentaje).toFixed(2)
      : '';
    const resultadoFinalTexto = resultadoMensual !== null && resultadoMensual !== undefined
      ? resultadoMensual.toFixed(2)
      : '';

    const mesNombre = MESES_NOMBRES[g.mes - 1] || `Mes ${g.mes}`;

    filas.push([
      escaparCsv(g.anio),
      escaparCsv(mesNombre),
      escaparCsv(g.areaNombre),
      escaparCsv(responsable),
      escaparCsv(p1Texto),
      escaparCsv(p2Texto),
      escaparCsv(resultadoFinalTexto),
    ].join(','));
  }

  return {
    contenido: filas.join('\r\n'),
    totalRegistros: gruposOrdenados.length,
  };
}

/**
 * Genera el contenido de atrasos.csv:
 * Columnas: NO, AÑO, MES, PERIODO, RESPONSABLE, AREA
 *
 * Estructura de agrupación:
 * - Ordenado por Año, Mes y Periodo.
 * - Numeración (1, 2, 3...) que se reinicia por cada periodo de cada mes.
 * - Una línea en blanco de separación entre el Periodo 1 y Periodo 2 del mismo mes.
 * - Dos líneas en blanco de separación entre meses distintos.
 */
export async function generarAtrasosCsvString(
  tx: PrismaTransaction | typeof prisma = prisma,
): Promise<{ contenido: string; totalRegistros: number }> {
  // Buscar envíos de auditorías que fueron entregadas tarde
  const envios = await tx.envioAuditoria.findMany({
    where: {
      invalidadoEn: null,
    },
    include: {
      objetivoAuditoria: {
        include: {
          area: {
            include: {
              usuariosArea: {
                include: { usuario: { select: { id: true, nombre: true } } },
              },
            },
          },
          asignacionesAuditoria: {
            include: {
              responsableCumplimiento: { select: { id: true, nombre: true } },
            },
          },
        },
      },
    },
    orderBy: [
      { objetivoAuditoria: { anio: 'asc' } },
      { objetivoAuditoria: { mes: 'asc' } },
      { objetivoAuditoria: { periodo: 'asc' } },
      { verificadoEn: 'asc' },
    ],
  });

  // Filtro estricto: entregadas con atraso
  const enviosTarde = envios.filter(
    (e) => !e.realizadaATiempo || e.verificadoEn.getTime() > e.objetivoAuditoria.terminaEn.getTime(),
  );

  // Mapear asignaciones mensuales para resolver titular real
  const asignacionesMensuales = await tx.asignacionMensual.findMany({
    include: {
      responsableCumplimiento: { select: { id: true, nombre: true } },
    },
  });
  const mapaAsigMensual = new Map<string, typeof asignacionesMensuales[number]>();
  for (const am of asignacionesMensuales) {
    mapaAsigMensual.set(`${am.anio}-${am.mes}-${am.areaId}`, am);
  }

  // Agrupar por anio -> mes -> periodo
  type ElementoAtraso = {
    anio: number;
    mes: number;
    periodo: number;
    responsable: string;
    area: string;
  };

  const agrupadoPorMesYPeriodo = new Map<string, Map<number, ElementoAtraso[]>>();

  for (const e of enviosTarde) {
    const obj = e.objetivoAuditoria;
    const claveMes = `${obj.anio}-${obj.mes}`;
    if (!agrupadoPorMesYPeriodo.has(claveMes)) {
      agrupadoPorMesYPeriodo.set(claveMes, new Map<number, ElementoAtraso[]>());
    }
    const mapaPeriodos = agrupadoPorMesYPeriodo.get(claveMes)!;
    if (!mapaPeriodos.has(obj.periodo)) {
      mapaPeriodos.set(obj.periodo, []);
    }

    const asigMensual = mapaAsigMensual.get(`${obj.anio}-${obj.mes}-${obj.areaId}`);
    const asigAuditoria = obj.asignacionesAuditoria.find((a) => a.id === e.asignacionAuditoriaId) || obj.asignacionesAuditoria[0];
    const responsableReal = resolverResponsableReal(obj.area, asigAuditoria, asigMensual);

    mapaPeriodos.get(obj.periodo)!.push({
      anio: obj.anio,
      mes: obj.mes,
      periodo: obj.periodo,
      responsable: responsableReal,
      area: obj.nombreAreaSnapshot,
    });
  }

  const filas: string[] = [];
  const cabecera = ['NO', 'AÑO', 'MES', 'PERIODO', 'RESPONSABLE', 'AREA']
    .map(escaparCsv)
    .join(',');
  filas.push(cabecera);

  const clavesMesesOrdenadas = Array.from(agrupadoPorMesYPeriodo.keys()).sort((a, b) => {
    const [anioA, mesA] = a.split('-').map(Number);
    const [anioB, mesB] = b.split('-').map(Number);
    if (anioA !== anioB) return anioA - anioB;
    return mesA - mesB;
  });

  let esPrimerMes = true;

  for (const claveMes of clavesMesesOrdenadas) {
    const mapaPeriodos = agrupadoPorMesYPeriodo.get(claveMes)!;
    const periodosPresentes = Array.from(mapaPeriodos.keys()).sort((a, b) => a - b);

    if (!esPrimerMes) {
      // Dos líneas en blanco entre meses distintos según formato solicitado
      filas.push('');
      filas.push('');
    }
    esPrimerMes = false;

    let esPrimerPeriodoDelMes = true;

    for (const periodo of periodosPresentes) {
      const items = mapaPeriodos.get(periodo) || [];
      if (items.length === 0) continue;

      if (!esPrimerPeriodoDelMes) {
        // Una línea en blanco de separación entre periodos del mismo mes
        filas.push('');
      }
      esPrimerPeriodoDelMes = false;

      // Numeración que se reinicia por cada periodo de cada mes (1, 2, 3, 4...)
      let contador = 1;
      for (const item of items) {
        const mesNombre = MESES_NOMBRES[item.mes - 1] || `Mes ${item.mes}`;
        const periodoNombre = item.periodo === 1 ? 'Primer Periodo' : 'Segundo Periodo';

        filas.push([
          escaparCsv(contador++),
          escaparCsv(item.anio),
          escaparCsv(mesNombre),
          escaparCsv(periodoNombre),
          escaparCsv(item.responsable),
          escaparCsv(item.area),
        ].join(','));
      }
    }
  }

  return {
    contenido: filas.join('\r\n'),
    totalRegistros: enviosTarde.length,
  };
}

/**
 * Ejecuta la escritura física atómica de ambos archivos CSV con BOM UTF-8.
 */
export async function ejecutarSincronizacionCsv(
  tx: PrismaTransaction | typeof prisma = prisma,
): Promise<ResultadoSincronizacionCsv> {
  const { dir, rutaResultados, rutaAtrasos } = obtenerRutasCsv();

  // Asegurar que el directorio de destino exista
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const [resResultados, resAtrasos] = await Promise.all([
    generarResultadosCsvString(tx),
    generarAtrasosCsvString(tx),
  ]);

  // BOM UTF-8 para garantizar apertura nativa impecable en Microsoft Excel (Windows)
  const BOM = '\uFEFF';

  // Escritura atómica mediante archivos temporales
  const tempResultados = `${rutaResultados}.tmp`;
  const tempAtrasos = `${rutaAtrasos}.tmp`;

  fs.writeFileSync(tempResultados, BOM + resResultados.contenido, 'utf8');
  fs.writeFileSync(tempAtrasos, BOM + resAtrasos.contenido, 'utf8');

  try {
    if (fs.existsSync(rutaResultados)) fs.unlinkSync(rutaResultados);
  } catch (err) {
    logger.debug(err, 'No fue necesario eliminar archivo anterior de resultados');
  }
  fs.renameSync(tempResultados, rutaResultados);

  try {
    if (fs.existsSync(rutaAtrasos)) fs.unlinkSync(rutaAtrasos);
  } catch (err) {
    logger.debug(err, 'No fue necesario eliminar archivo anterior de atrasos');
  }
  fs.renameSync(tempAtrasos, rutaAtrasos);

  const resultado: ResultadoSincronizacionCsv = {
    rutaResultados,
    rutaAtrasos,
    totalResultados: resResultados.totalRegistros,
    totalAtrasos: resAtrasos.totalRegistros,
    actualizadoEn: new Date(),
  };

  logger.info(
    `[CSV Sync] Archivos actualizados exitosamente en ${dir}: resultados (${resultado.totalResultados} filas), atrasos (${resultado.totalAtrasos} filas)`,
  );

  return resultado;
}

// -----------------------------------------------------------------------------
// CONTROL DE CONCURRENCIA (MUTEX / COALESCING)
// -----------------------------------------------------------------------------
let sincronizacionEnCurso: Promise<ResultadoSincronizacionCsv> | null = null;
let sincronizacionPendiente = false;

/**
 * Ejecuta la sincronización asegurando que múltiples peticiones concurrentes
 * no provoquen bloqueos de archivo en Windows (EBUSY).
 */
export async function sincronizarArchivosCsv(): Promise<ResultadoSincronizacionCsv> {
  if (sincronizacionEnCurso) {
    sincronizacionPendiente = true;
    return sincronizacionEnCurso;
  }

  sincronizacionEnCurso = (async () => {
    try {
      const res = await ejecutarSincronizacionCsv(prisma);
      return res;
    } finally {
      sincronizacionEnCurso = null;
      if (sincronizacionPendiente) {
        sincronizacionPendiente = false;
        setImmediate(() => {
          void sincronizarArchivosCsv().catch((err) => {
            logger.error(err, '[CSV Sync] Error al procesar sincronización en cola');
          });
        });
      }
    }
  })();

  return sincronizacionEnCurso;
}

/**
 * Dispara la sincronización en segundo plano de manera no bloqueante.
 * No interrumpe la respuesta HTTP del cliente si ocurre una falla de I/O en disco.
 */
export function solicitarSincronizacionCsv(): void {
  setImmediate(() => {
    sincronizarArchivosCsv().catch((err) => {
      logger.error(err, '[CSV Sync] Error no controlado durante exportación automática');
    });
  });
}
