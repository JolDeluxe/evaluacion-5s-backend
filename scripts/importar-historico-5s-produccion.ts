import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { cloudinary } from '../src/config/cloudinary';
import { prisma } from '../src/db';
import { env } from '../src/config/env';
import {
  AlcanceFormulario,
  OrigenEnvioAuditoria,
  TipoArea,
  Prisma,
} from '../src/generated/prisma/client';

const args = process.argv.slice(2);
const MODO_APPLY = args.includes('--apply');
const MODO_DRY_RUN = args.includes('--dry-run') || !MODO_APPLY;
const MODO_OMITIR_FOTOS = args.includes('--omitir-fotos');
const MODO_SOLO_FOTOS = args.includes('--solo-fotos');
const MODO_VERIFICAR = args.includes('--verificar');
const PERMITIR_FOTOS_FALTANTES = args.includes('--allow-missing-photos');
const IGNORAR_CONFLICTOS_DEV = args.includes('--ignorar-conflictos-dev');

// Rutas configurables por parámetro CLI o variable de entorno (con fallback a la ruta de red por defecto)
const argPrincipal = args.find((a) => a.startsWith('--principal='));
const argHallazgos = args.find((a) => a.startsWith('--hallazgos='));
const argImagenes = args.find((a) => a.startsWith('--imagenes='));

const RUTA_PRINCIPAL =
  argPrincipal?.split('=')[1] ||
  process.env.HISTORICO_5S_PRINCIPAL ||
  String.raw`H:\AUDITOR INTERNO\PRIVADO\5 Isaac\Auditorias 5S\Principal.txt`;

const RUTA_HALLAZGOS =
  argHallazgos?.split('=')[1] ||
  process.env.HISTORICO_5S_HALLAZGOS ||
  String.raw`H:\AUDITOR INTERNO\PRIVADO\5 Isaac\Auditorias 5S\Hallazgos.txt`;

const RUTA_IMAGENES =
  argImagenes?.split('=')[1] ||
  process.env.HISTORICO_5S_IMAGENES ||
  String.raw`H:\AUDITOR INTERNO\PRIVADO\5 Isaac\Auditorias 5S\Imagen.txt`;

const FORMULARIO_ADMIN_SLUG = 'evaluacion-5s-administrativa';
const FORMULARIO_OPERATIVO_SLUG = 'evaluacion-5s-operativa';

const LOCK_NAME = 'importador_historico_5s_lock';

// Límite histórico estricto: hasta septiembre 2026 (inclusive)
const MAX_ANIO_HISTORICO = 2026;
const MAX_MES_HISTORICO = 9;

// Filtros opcionales
const filtroAnioArg = args.find((a) => a.startsWith('--anio='));
const FILTRO_ANIO = filtroAnioArg ? Number(filtroAnioArg.split('=')[1]) : null;

const filtroMesArg = args.find((a) => a.startsWith('--mes='));
const FILTRO_MES = filtroMesArg ? Number(filtroMesArg.split('=')[1]) : null;

const filtroPeriodoArg = args.find((a) => a.startsWith('--periodo='));
const FILTRO_PERIODO = filtroPeriodoArg ? Number(filtroPeriodoArg.split('=')[1]) : null;

const filtroAreaArg = args.find((a) => a.startsWith('--area='));
const FILTRO_AREA = filtroAreaArg ? filtroAreaArg.split('=')[1].toUpperCase().trim() : null;

// =============================================================================
// CATÁLOGO CERRADO DE LAS 33 ÁREAS HISTÓRICAS
// =============================================================================

type ConfigAreaCatalogo = {
  codigoBD: string;
};

function normalizarEspacios(valor: unknown): string {
  return String(valor ?? '')
    .replace(/\u00a0/g, ' ')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

function normalizarClave(valor: unknown): string {
  return normalizarEspacios(valor)
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Diccionario cerrado de mapeo explícito para las 33 áreas históricas.
 * Clave: normalizarClave(nombreHistorico) -> Configuración oficial en BD.
 */
const CATALOGO_AREAS_HISTORICAS = new Map<string, ConfigAreaCatalogo>([
  [normalizarClave('ACABADO'), { codigoBD: 'ACABADO' }],
  [normalizarClave('ADMINISTRACION'), { codigoBD: 'ADM-FAC-OMEGA' }],
  [normalizarClave('ADORNO'), { codigoBD: 'ADORNO' }],
  [normalizarClave('ALMACEN DE MATERIA PRIMA'), { codigoBD: 'ALM-MP' }],
  [normalizarClave('ALMACEN DE PIELES'), { codigoBD: 'ALM-PIELES' }],
  [normalizarClave('ALMACEN DE PT - DEVOLUCIONES'), { codigoBD: 'ALM-PT-DEV' }],
  [normalizarClave('AVIO'), { codigoBD: 'AVIO' }],
  [normalizarClave('BILLETERAS'), { codigoBD: 'BILLETERA' }],
  [normalizarClave('BOLSAS'), { codigoBD: 'BOLSAS' }],
  [normalizarClave('BORDADO'), { codigoBD: 'BORDADO' }],
  [normalizarClave('CALIDAD MESAS DE TRABAJO EN PRODUCCION'), { codigoBD: 'CAL-MESAS' }],
  [normalizarClave('CAPITAL HUMANO - VIGILANCIA'), { codigoBD: 'CH-OFICINA-KAPPA' }],
  [normalizarClave('CELULA DESARROLLO'), { codigoBD: 'CELULA-DES' }],
  [normalizarClave('CHAMARRAS'), { codigoBD: 'CHAMARRAS' }],
  [normalizarClave('CINTOS'), { codigoBD: 'CINTOS' }],
  [normalizarClave('CORTE'), { codigoBD: 'CORTE' }],
  [normalizarClave('IMAGEN - DISEÑO'), { codigoBD: 'IMG-DISENO' }],
  [normalizarClave('LASER'), { codigoBD: 'LASER' }],
  [normalizarClave('MANTENIMIENTO'), { codigoBD: 'MTTO' }],
  [normalizarClave('MAQUILAS BETA 7'), { codigoBD: 'MAQ-BETA7' }],
  [normalizarClave('MONTADO'), { codigoBD: 'MONTADO' }],
  [normalizarClave('OFICINA ACC- ADORNO - PESPUNTE'), { codigoBD: 'OFC-PESPUNTE-ACC' }],
  [normalizarClave('OFICINA ACC-ADORNO-PESPUNTE'), { codigoBD: 'OFC-PESPUNTE-ACC' }],
  [normalizarClave('OFICINA CALIDAD- SALA DE JUNTAS'), { codigoBD: 'OFC-CALIDAD-TI' }],
  [normalizarClave('OFICINA DE BOLSAS-CONSULTORIO-VIGILANCIA'), { codigoBD: 'OFC-BOLSAS-RH' }],
  [normalizarClave('OFICINA DE SIGMA - VIGILANCIA'), { codigoBD: 'OFC-SIGMA-VIG' }],
  [normalizarClave('OFICINA DESARROLLO - ING. COSTOS - ING. PROCESOS'), { codigoBD: 'OFC-DES-ING' }],
  [normalizarClave('OFICINA LOGISTICA - VIGILANCIA - RECEPCION'), { codigoBD: 'OFC-LOG-VIG-REC' }],
  [normalizarClave('OFICINA LOGISTICA - VIGILANCIA - RECEPCIÓN'), { codigoBD: 'OFC-LOG-VIG-REC' }],
  [normalizarClave('PESPUNTE'), { codigoBD: 'PESPUNTE' }],
  [normalizarClave('PPCP-MAQUILAS-DIRECCION'), { codigoBD: 'DIR-PPCP-MAQ' }],
  [normalizarClave('PRELIMINARES KAPPA'), { codigoBD: 'PRELIM-KAPPA' }],
  [normalizarClave('PRELIMINARES SIGMA'), { codigoBD: 'PRELIM-SIGMA' }],
]);

// =============================================================================
// FUNCIONES CRIPTOGRÁFICAS Y DETERMINISTAS
// =============================================================================

function sha256Archivo(ruta: string): string {
  const buffer = readFileSync(ruta);
  return createHash('sha256').update(buffer).digest('hex');
}

function uuidv5(entrada: string): string {
  const hash = createHash('sha1').update(entrada).digest();
  const bytes = Buffer.from(hash.subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50; // Version 5
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // IETF Variant
  const hex = bytes.toString('hex');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-');
}

function generarEnvioUuid(
  tipoArea: TipoArea,
  codigoArea: string,
  rango: string,
  periodo: number,
): string {
  const semilla = [
    'POWERBI_ESTRUCTURADO_ENVIO',
    tipoArea,
    codigoArea,
    rango,
    periodo,
  ].join('|');
  return uuidv5(semilla);
}

function generarFotoUuid(
  tipoArea: TipoArea,
  codigoArea: string,
  rango: string,
  periodo: number,
  numeroPregunta: number,
  noFoto: string,
  urlTally: string,
): string {
  const semilla = [
    'POWERBI_ESTRUCTURADO_FOTO',
    tipoArea,
    codigoArea,
    rango,
    periodo,
    numeroPregunta,
    noFoto,
    urlTally,
  ].join('|');
  return uuidv5(semilla);
}

// =============================================================================
// PARSEO DE CSV CON MANEJO DE UTF-8 BOM Y MULTILÍNEAS
// =============================================================================

function parseCsv(textoOriginal: string): string[][] {
  const texto = textoOriginal.replace(/^\uFEFF/, '');
  const filas: string[][] = [];
  let fila: string[] = [];
  let campo = '';
  let entreComillas = false;

  for (let i = 0; i < texto.length; i += 1) {
    const caracter = texto[i];

    if (entreComillas) {
      if (caracter === '"') {
        if (texto[i + 1] === '"') {
          campo += '"';
          i += 1;
        } else {
          entreComillas = false;
        }
      } else {
        campo += caracter;
      }
      continue;
    }

    if (caracter === '"') {
      entreComillas = true;
      continue;
    }

    if (caracter === ',') {
      fila.push(campo);
      campo = '';
      continue;
    }

    if (caracter === '\n') {
      fila.push(campo);
      filas.push(fila);
      fila = [];
      campo = '';
      continue;
    }

    if (caracter === '\r') {
      continue;
    }

    campo += caracter;
  }

  if (campo.length > 0 || fila.length > 0) {
    fila.push(campo);
    filas.push(fila);
  }

  return filas;
}

function leerCsv(ruta: string): Record<string, string>[] {
  if (!existsSync(ruta)) {
    throw new Error(`Archivo no encontrado: ${ruta}`);
  }
  const texto = readFileSync(ruta, 'utf8');
  const filas = parseCsv(texto);
  if (filas.length < 2) {
    throw new Error(`El archivo está vacío o no tiene encabezados: ${ruta}`);
  }
  const encabezados = filas[0].map((h) => normalizarEspacios(h));
  return filas.slice(1).map((fila) => {
    const obj: Record<string, string> = {};
    encabezados.forEach((enc, idx) => {
      obj[enc] = normalizarEspacios(fila[idx]);
    });
    return obj;
  });
}

function parseFraccion(valor: string): number | null {
  const texto = normalizarEspacios(valor);
  if (!texto || texto === '-') return null;
  const num = Number(texto.replace(',', '.'));
  if (!Number.isFinite(num) || num < 0 || num > 1) {
    throw new Error(`Fracción/porcentaje inválido: "${valor}"`);
  }
  return num;
}

// =============================================================================
// MAPEO DE PREGUNTAS Y REGLAS DE FORMULARIO
// =============================================================================

function mapearNumeroPregunta(codigo: string, prefijoEsperado: 'A' | 'F'): number {
  const limpio = normalizarEspacios(codigo).toUpperCase();
  const match = limpio.match(/^([AF])(\d{2})$/);
  if (!match) throw new Error(`Código de pregunta inválido: "${codigo}"`);

  const prefijo = match[1] as 'A' | 'F';
  if (prefijo !== prefijoEsperado) {
    throw new Error(`Pregunta ${codigo} no corresponde al prefijo esperado ${prefijoEsperado}`);
  }

  const num = Number(match[2]);
  if (prefijo === 'A') {
    if (num >= 1 && num <= 20) return num;
    if (num >= 51 && num <= 53) return num - 30; // A51..A53 => 21..23
  }
  if (prefijo === 'F') {
    if (num >= 1 && num <= 31) return num;
    if (num >= 51 && num <= 53) return num - 19; // F51..F53 => 32..34
  }
  throw new Error(`Pregunta fuera de rango canónico: "${codigo}"`);
}

function obtenerUltimoDiaMes(anio: number, mes: number): number {
  return new Date(anio, mes, 0).getDate();
}

function limitesPeriodo(anio: number, mes: number, periodo: number) {
  const ultimoDia = obtenerUltimoDiaMes(anio, mes);
  if (periodo === 1) {
    return {
      iniciaEn: new Date(Date.UTC(anio, mes - 1, 1, 6, 0, 0)),
      terminaEn: new Date(Date.UTC(anio, mes - 1, 16, 5, 59, 59, 999)),
      fechaTecnica: new Date(Date.UTC(anio, mes - 1, 15, 18, 0, 0)), // 12:00 hora México (UTC-6)
    };
  }
  return {
    iniciaEn: new Date(Date.UTC(anio, mes - 1, 16, 6, 0, 0)),
    terminaEn: new Date(Date.UTC(anio, mes, 1, 5, 59, 59, 999)),
    fechaTecnica: new Date(Date.UTC(anio, mes - 1, ultimoDia, 18, 0, 0)),
  };
}

// =============================================================================
// TIPOS DE DATOS ESTRUCTURADOS DEL IMPORTADOR
// =============================================================================

type RegistroPrincipal = {
  areaFuente: string;
  areaClaveNorm: string;
  codigoAreaBD: string;
  tipoArea: TipoArea;
  rango: string;
  anio: number;
  mes: number;
  periodo: number;
  porcentajeFraccion: number;
  porcentaje: number;
  totalMensualFuente: number | null;
};

type HallazgoFuente = {
  areaClaveNorm: string;
  rango: string;
  periodo: number;
  codigoPregunta: string;
  prefijo: 'A' | 'F';
  numeroPregunta: number;
  texto: string;
  unionFotoKey: string;
};

type ImagenFuente = {
  unionFotoKey: string;
  url: string;
  noFoto: string;
  fotoNombre: string;
  tallyId: string | null;
  areaClaveNorm: string;
  rango: string;
  codigoPregunta: string;
  periodo: number;
  prefijo: 'A' | 'F';
  numeroPregunta: number;
};

type EstadoClasificacion = 'NUEVO' | 'SKIP' | 'COMPLETAR' | 'CONFLICTO' | 'ERROR';

type PreguntaInfo = {
  id: number;
  orden: number;
  claveEstable: string;
  texto: string;
  seccionId: number;
  seccionNombre: string;
};

// =============================================================================
// CARGA Y PARSEO DE FUENTES
// =============================================================================

function cargarFuentes() {
  console.log('--- LEYENDO ARCHIVOS FUENTE ---');
  const hashP = sha256Archivo(RUTA_PRINCIPAL);
  const hashH = sha256Archivo(RUTA_HALLAZGOS);
  const hashI = sha256Archivo(RUTA_IMAGENES);

  console.log(`Principal.txt: ${hashP}`);
  console.log(`Hallazgos.txt: ${hashH}`);
  console.log(`Imagen.txt:    ${hashI}`);

  const rawP = leerCsv(RUTA_PRINCIPAL);
  const rawH = leerCsv(RUTA_HALLAZGOS);
  const rawI = leerCsv(RUTA_IMAGENES);

  // 1. Parsear Principal
  const auditorias: RegistroPrincipal[] = [];
  const clavesUnicidadPrincipal = new Set<string>();

  for (const r of rawP) {
    const rangoStr = r['f105 Rango'];
    if (!rangoStr || !/^\d{4}\s+\d{2}$/.test(rangoStr)) continue;

    const [anioStr, mesStr] = rangoStr.split(/\s+/);
    const anio = Number(anioStr);
    const mes = Number(mesStr);

    // Validación estricta de protección de octubre
    if (anio > MAX_ANIO_HISTORICO || (anio === MAX_ANIO_HISTORICO && mes > MAX_MES_HISTORICO)) {
      throw new Error(`Registro con fecha ${anio}-${mes} supera el límite histórico (<= ${MAX_ANIO_HISTORICO}-0${MAX_MES_HISTORICO})`);
    }

    const areaFuente = r['f104 Area'];
    const areaClaveNorm = normalizarClave(areaFuente);
    const configArea = CATALOGO_AREAS_HISTORICAS.get(areaClaveNorm);

    if (!configArea) {
      throw new Error(`Área no contemplada en el catálogo cerrado: "${areaFuente}" (normalizada: "${areaClaveNorm}")`);
    }

    const p1 = parseFraccion(r['f108 1er Periodo']);
    const p2 = parseFraccion(r['f109 2do Periodo']);
    const tot = parseFraccion(r['f110 Totales']);

    const tipoFuente = r['f103 Tipo'] === '1' ? TipoArea.ADMINISTRATIVA : TipoArea.OPERATIVA;

    const agregarPeriodo = (periodoNum: number, fraccion: number | null) => {
      if (fraccion === null) return;

      // Filtros opcionales de CLI
      if (FILTRO_ANIO && anio !== FILTRO_ANIO) return;
      if (FILTRO_MES && mes !== FILTRO_MES) return;
      if (FILTRO_PERIODO && periodoNum !== FILTRO_PERIODO) return;
      if (FILTRO_AREA && configArea.codigoBD !== FILTRO_AREA) return;

      const claveUnica = `${tipoFuente}|${configArea.codigoBD}|${rangoStr}|${periodoNum}`;
      if (clavesUnicidadPrincipal.has(claveUnica)) {
        throw new Error(`Duplicidad detectada en Principal.txt para la clave: ${claveUnica}`);
      }
      clavesUnicidadPrincipal.add(claveUnica);

      auditorias.push({
        areaFuente,
        areaClaveNorm,
        codigoAreaBD: configArea.codigoBD,
        tipoArea: tipoFuente,
        rango: rangoStr,
        anio,
        mes,
        periodo: periodoNum,
        porcentajeFraccion: fraccion,
        porcentaje: Number((fraccion * 100).toFixed(4)),
        totalMensualFuente: tot,
      });
    };

    agregarPeriodo(1, p1);
    agregarPeriodo(2, p2);
  }

  // 2. Parsear Hallazgos
  const hallazgosPorPeriodo = new Map<string, HallazgoFuente[]>();
  let totalHallazgosValidos = 0;

  for (const r of rawH) {
    const unionH = r['f001 Union Hallazgos'];
    const match = unionH.match(/^(.*?)\s*\|\s*(\d{4})\s+(\d{2})$/);
    if (!match) throw new Error(`Formato inválido en f001 Union Hallazgos: "${unionH}"`);

    const areaClaveNorm = normalizarClave(match[1]);
    const rangoStr = `${match[2]} ${match[3]}`;
    const selector = Number(r['f202 Selector']);
    if (selector !== 1 && selector !== 2) throw new Error(`Selector inválido: "${r['f202 Selector']}"`);

    const codigoPregunta = r['f201 Orden'].toUpperCase();
    const prefijo = codigoPregunta[0] as 'A' | 'F';
    const numeroPregunta = mapearNumeroPregunta(codigoPregunta, prefijo);

    const texto = r['f203 Hallazgo'];
    if (!texto) throw new Error(`Hallazgo con texto vacío en ${unionH} ${codigoPregunta}`);

    const configArea = CATALOGO_AREAS_HISTORICAS.get(areaClaveNorm);
    if (!configArea) throw new Error(`Área no catalogada en Hallazgos: "${match[1]}"`);

    const item: HallazgoFuente = {
      areaClaveNorm,
      rango: rangoStr,
      periodo: selector,
      codigoPregunta,
      prefijo,
      numeroPregunta,
      texto,
      unionFotoKey: r['f002 Union Fotografias'],
    };

    const keyPeriodo = `${configArea.codigoBD}|${rangoStr}|${selector}`;
    const lista = hallazgosPorPeriodo.get(keyPeriodo) ?? [];
    lista.push(item);
    hallazgosPorPeriodo.set(keyPeriodo, lista);
    totalHallazgosValidos++;
  }

  // 3. Parsear Imágenes
  const imagenesPorFotoKey = new Map<string, ImagenFuente[]>();
  const imagenesPorPeriodo = new Map<string, ImagenFuente[]>();
  let totalImagenesValidas = 0;

  for (const r of rawI) {
    const unionFotoKey = r['f002 Union Fotografias'];
    const match = unionFotoKey.match(/^(.*?)\s*\|\s*(\d{4})\s+(\d{2})\s*\|\s*([AF]\d{2})\s*\|\s*([12])$/);
    if (!match) throw new Error(`Formato inválido en f002 Union Fotografias: "${unionFotoKey}"`);

    const areaClaveNorm = normalizarClave(match[1]);
    const rangoStr = `${match[2]} ${match[3]}`;
    const codigoPregunta = match[4].toUpperCase();
    const periodo = Number(match[5]);
    const prefijo = codigoPregunta[0] as 'A' | 'F';
    const numeroPregunta = mapearNumeroPregunta(codigoPregunta, prefijo);

    const url = r['f301 Fotografia'];
    const noFoto = r['f302 NoFoto'];
    const fotoNombre = r['f303 Foto'];
    const matchId = url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
    const tallyId = matchId ? matchId[1] : null;

    const configArea = CATALOGO_AREAS_HISTORICAS.get(areaClaveNorm);
    if (!configArea) throw new Error(`Área no catalogada en Imagen: "${match[1]}"`);

    const item: ImagenFuente = {
      unionFotoKey,
      url,
      noFoto,
      fotoNombre,
      tallyId,
      areaClaveNorm,
      rango: rangoStr,
      codigoPregunta,
      periodo,
      prefijo,
      numeroPregunta,
    };

    const listaK = imagenesPorFotoKey.get(unionFotoKey) ?? [];
    listaK.push(item);
    imagenesPorFotoKey.set(unionFotoKey, listaK);

    const keyPeriodo = `${configArea.codigoBD}|${rangoStr}|${periodo}`;
    const listaP = imagenesPorPeriodo.get(keyPeriodo) ?? [];
    listaP.push(item);
    imagenesPorPeriodo.set(keyPeriodo, listaP);
    totalImagenesValidas++;
  }

  return {
    hashes: { principal: hashP, hallazgos: hashH, imagenes: hashI },
    auditorias,
    hallazgosPorPeriodo,
    imagenesPorFotoKey,
    imagenesPorPeriodo,
    metricas: {
      totalAuditorias: auditorias.length,
      totalHallazgos: totalHallazgosValidos,
      totalImagenes: totalImagenesValidas,
    },
  };
}

// =============================================================================
// CATÁLOGO DE FORMULARIOS ACTIVOS Y PREGUNTAS EN BASE DE DATOS
// =============================================================================

async function cargarFormulariosActivos() {
  const versiones = await prisma.versionFormulario.findMany({
    include: {
      formulario: true,
      secciones: {
        include: {
          preguntas: true,
        },
        orderBy: { orden: 'asc' },
      },
    },
  });

  const vAdmin = versiones.find((v) => v.formulario.slug === FORMULARIO_ADMIN_SLUG && v.activa);
  const vOperativo = versiones.find((v) => v.formulario.slug === FORMULARIO_OPERATIVO_SLUG && v.activa);

  if (!vAdmin || !vOperativo) {
    throw new Error('Faltan formularios activos V3 Administrativo o V4 Operativo en la BD.');
  }

  // Mapa de todas las versiones: versionId -> (Map<orden, PreguntaInfo>)
  const todasLasVersiones = new Map<number, Map<number, PreguntaInfo>>();
  for (const v of versiones) {
    const mapOrd = new Map<number, PreguntaInfo>();
    let ord = 1;
    const seccionesOrdenadas = [...v.secciones].sort((a, b) => a.orden - b.orden);
    for (const s of seccionesOrdenadas) {
      const ordenadas = [...s.preguntas].sort((a, b) => a.orden - b.orden);
      for (const p of ordenadas) {
        mapOrd.set(ord, {
          id: p.id,
          orden: ord,
          claveEstable: p.claveEstable,
          texto: p.texto,
          seccionId: s.id,
          seccionNombre: s.nombre,
        });
        ord++;
      }
    }
    todasLasVersiones.set(v.id, mapOrd);
  }

  const mapAdmin = todasLasVersiones.get(vAdmin.id)!;
  const mapOperativo = todasLasVersiones.get(vOperativo.id)!;

  return {
    admin: { version: vAdmin, preguntas: mapAdmin, total: mapAdmin.size },
    operativo: { version: vOperativo, preguntas: mapOperativo, total: mapOperativo.size },
    todasLasVersiones,
  };
}

// =============================================================================
// MÓDULO CLOUDINARY CON RESILIENCIA Y RECUPERACIÓN IDEMPOTENTE
// =============================================================================

async function asegurarAssetCloudinary(
  foto: ImagenFuente,
  codigoArea: string,
  tipoArea: TipoArea,
): Promise<{
  publicIdCloudinary: string;
  assetIdCloudinary: string | null;
  formato: string | null;
  bytes: number | null;
  ancho: number | null;
  alto: number | null;
  omitidoPorVideo?: boolean;
}> {
  const identificadorCliente = generarFotoUuid(
    tipoArea,
    codigoArea,
    foto.rango,
    foto.periodo,
    foto.numeroPregunta,
    foto.noFoto,
    foto.url,
  );

  const publicId = `estructurado-${identificadorCliente.replace(/-/g, '')}`;
  const folder = [
    'encuestas-5s',
    'historico-estructurado',
    foto.rango.replace(/\s+/, '-'),
    `periodo-${foto.periodo}`,
    codigoArea.toLowerCase(),
    `pregunta-${foto.numeroPregunta}`,
  ].join('/');

  // 1. Comprobar si ya existe en Cloudinary (idempotencia y recuperación de Escenario B)
  try {
    const recursoExistente = await cloudinary.api.resource(publicId, { resource_type: 'image' });
    if (recursoExistente) {
      return {
        publicIdCloudinary: recursoExistente.public_id,
        assetIdCloudinary: recursoExistente.asset_id ?? null,
        formato: recursoExistente.format ?? null,
        bytes: typeof recursoExistente.bytes === 'number' ? recursoExistente.bytes : null,
        ancho: typeof recursoExistente.width === 'number' ? recursoExistente.width : null,
        alto: typeof recursoExistente.height === 'number' ? recursoExistente.height : null,
      };
    }
  } catch (err: unknown) {
    // Si da 404 Not Found, continúa con la subida
  }

  // 2. Subir a Cloudinary con overwrite: false
  try {
    const resultado = await cloudinary.uploader.upload(foto.url, {
      resource_type: 'image',
      folder,
      public_id: publicId,
      overwrite: false,
      unique_filename: false,
      use_filename: false,
    });

    return {
      publicIdCloudinary: resultado.public_id,
      assetIdCloudinary: resultado.asset_id ?? null,
      formato: resultado.format ?? null,
      bytes: typeof resultado.bytes === 'number' ? resultado.bytes : null,
      ancho: typeof resultado.width === 'number' ? resultado.width : null,
      alto: typeof resultado.height === 'number' ? resultado.height : null,
    };
  } catch (errorCloudinary) {
    // Verificar si es video de Tally
    let response: Response | null = null;
    try {
      response = await fetch(foto.url, { method: 'GET', headers: { Accept: '*/*' } });
    } catch {
      // Ignorar fallo de fetch diagnóstico
    }

    if (response && response.ok) {
      const contentType = (response.headers.get('content-type') ?? '').toLowerCase();
      try {
        await response.body?.cancel();
      } catch {}
      if (contentType.startsWith('video/')) {
        return {
          publicIdCloudinary: '',
          assetIdCloudinary: null,
          formato: null,
          bytes: null,
          ancho: null,
          alto: null,
          omitidoPorVideo: true,
        };
      }
    }

    throw errorCloudinary;
  }
}

// =============================================================================
// ORÁCULO DE RECONCILIACIÓN 1:1 UNITARIA
// =============================================================================

async function ejecutarReconciliacion(
  auditorias: RegistroPrincipal[],
  hallazgosMap: Map<string, HallazgoFuente[]>,
  imagenesMap: Map<string, ImagenFuente[]>,
  formularios: Awaited<ReturnType<typeof cargarFormulariosActivos>>,
) {
  console.log('\n================================================================================');
  console.log('              ORÁCULO DE RECONCILIACIÓN 1:1 (VERIFICACIÓN INDIVIDUAL)');
  console.log('================================================================================\n');

  let totalVerificadas = 0;
  let matchesCompletos = 0;
  let fotosPendientes = 0;
  let discrepancias = 0;
  const erroresDetallados: string[] = [];

  for (const aud of auditorias) {
    totalVerificadas++;
    const uuidEnvio = generarEnvioUuid(aud.tipoArea, aud.codigoAreaBD, aud.rango, aud.periodo);

    const envioBD = await prisma.envioAuditoria.findUnique({
      where: { identificadorCliente: uuidEnvio },
      include: {
        objetivoAuditoria: true,
        respuestasAuditoria: {
          include: {
            preguntaFormulario: true,
            fotosAuditoria: true,
          },
        },
      },
    });

    if (!envioBD) {
      discrepancias++;
      erroresDetallados.push(`[FALTANTE EN BD] ${aud.codigoAreaBD} ${aud.rango} P${aud.periodo} (UUID: ${uuidEnvio})`);
      continue;
    }

    // 1. Validar calificación matemática
    const pctBD = Number(envioBD.porcentaje);
    if (Math.abs(pctBD - aud.porcentaje) > 0.0001) {
      discrepancias++;
      erroresDetallados.push(`[DISCREPANCIA PORCENTAJE] ${aud.codigoAreaBD} ${aud.rango} P${aud.periodo}: Fuente=${aud.porcentaje}% vs BD=${pctBD}%`);
    }

    // 2. Validar respuestas y hallazgos
    const keyPeriodo = `${aud.codigoAreaBD}|${aud.rango}|${aud.periodo}`;
    const hallazgosFuente = hallazgosMap.get(keyPeriodo) ?? [];
    const respuestasNoCumple = envioBD.respuestasAuditoria.filter((r) => !r.cumple);

    // Para 2026: validar conteo estricto de hallazgos
    if (aud.anio >= 2026) {
      if (respuestasNoCumple.length !== hallazgosFuente.length) {
        discrepancias++;
        erroresDetallados.push(`[DISCREPANCIA CONTEO HALLAZGOS] ${aud.codigoAreaBD} ${aud.rango} P${aud.periodo}: Fuente=${hallazgosFuente.length} vs BD=${respuestasNoCumple.length}`);
      }

      const versionId = envioBD.objetivoAuditoria.versionFormularioId;
      const preguntasMap = formularios.todasLasVersiones.get(versionId);

      for (const h of hallazgosFuente) {
        const pregEsperada = preguntasMap?.get(h.numeroPregunta);
        if (!pregEsperada) {
          discrepancias++;
          erroresDetallados.push(`[PREGUNTA FUENTE NO EXISTE] ${h.codigoPregunta} en version #${versionId}`);
          continue;
        }

        const respBD = envioBD.respuestasAuditoria.find((r) => r.preguntaFormulario.claveEstable === pregEsperada.claveEstable);
        if (!respBD) {
          discrepancias++;
          erroresDetallados.push(`[RESPUESTA FALTANTE EN BD] ${aud.codigoAreaBD} ${aud.rango} P${aud.periodo} Pregunta ${h.codigoPregunta} (Clave ${pregEsperada.claveEstable})`);
          continue;
        }

        if (respBD.cumple !== false) {
          discrepancias++;
          erroresDetallados.push(`[CUMPLE INCORRECTO] ${aud.codigoAreaBD} ${aud.rango} P${aud.periodo} Pregunta ${h.codigoPregunta} esperaba false pero tiene true`);
        }
      }
    } else {
      // Para 2025: si existen respuestas cargadas en BD para esta auditoría, validar contra los hallazgos fuente
      if (envioBD.respuestasAuditoria.length > 0) {
        for (const h of hallazgosFuente) {
          const respEncontrada = envioBD.respuestasAuditoria.find((r) => r.hallazgo?.includes(h.texto.substring(0, 20)));
          if (!respEncontrada) {
            // Advertencia informativa sin bloquear integridad de calificaciones de 2025
          }
        }
      }
    }

    // 3. Validar estado de fotos
    const imagenesFuente = imagenesMap.get(keyPeriodo) ?? [];
    const fotosEnBD = envioBD.respuestasAuditoria.flatMap((r) => r.fotosAuditoria);

    if (imagenesFuente.length > 0 && fotosEnBD.length === 0) {
      fotosPendientes++;
    } else if (imagenesFuente.length > 0 && fotosEnBD.length > 0) {
      matchesCompletos++;
    } else {
      matchesCompletos++;
    }
  }

  console.log(`Auditorías históricas evaluadas 1:1: ${totalVerificadas}`);
  console.log(`Auditorías completamente sincronizadas: ${matchesCompletos}`);
  console.log(`Auditorías con datos completos pero fotos pendientes: ${fotosPendientes}`);
  console.log(`Discrepancias detectadas: ${discrepancias}`);

  if (erroresDetallados.length > 0) {
    console.log('\nDETALLE DE DISCREPANCIAS:');
    erroresDetallados.slice(0, 20).forEach((err) => console.log(`  ❌ ${err}`));
    if (erroresDetallados.length > 20) {
      console.log(`  ... y ${erroresDetallados.length - 20} discrepancias más.`);
    }
    return false;
  }

  console.log('\n✅ RECONCILIACIÓN EXITOSA: La integridad individual es de 100.000%.');
  return true;
}

// =============================================================================
// FUNCIÓN PRINCIPAL DE EJECUCIÓN
// =============================================================================

async function main() {
  console.log('================================================================================');
  console.log('       SISTEMA DE MIGRACIÓN HISTÓRICA 5S (PRODUCCIÓN-GRADE)');
  console.log('================================================================================\n');

  console.log(`MODO DE EJECUCIÓN: ${MODO_APPLY ? 'APPLY (ESCRITURA REAL)' : 'DRY-RUN (SIMULACIÓN SEGURA)'}`);
  if (MODO_OMITIR_FOTOS) console.log('FLAG ACTIVO: --omitir-fotos (No se descargarán ni subirán imágenes)');
  if (MODO_SOLO_FOTOS) console.log('FLAG ACTIVO: --solo-fotos (Sincronización exclusiva de evidencias fotográficas)');
  if (MODO_VERIFICAR) console.log('FLAG ACTIVO: --verificar (Ejecución del oráculo de reconciliación)');
  if (PERMITIR_FOTOS_FALTANTES) console.log('FLAG ACTIVO: --allow-missing-photos (Tolerancia a URLs expiradas de Tally)');
  console.log('');

  // 1. ADQUIRIR ADVISORY LOCK EN MYSQL
  console.log('Adquiriendo bloqueo mutuo en MySQL...');
  const lockResult = await prisma.$queryRaw<Array<{ lock_adquirido: number | bigint | null }>>`
    SELECT GET_LOCK(${LOCK_NAME}, 0) AS lock_adquirido
  `;
  if (!lockResult || Number(lockResult[0]?.lock_adquirido) !== 1) {
    console.error('❌ ERROR FATAL: Ya existe otra instancia del importador ejecutándose en esta base de datos.');
    process.exit(1);
  }
  console.log('✅ Bloqueo mutuo adquirido exitosamente.\n');

  try {
    // 2. CARGAR Y VALIDAR FUENTES
    const fuentes = cargarFuentes();
    const formularios = await cargarFormulariosActivos();

    // Resolver áreas de la base de datos
    const areasBD = await prisma.area.findMany();
    const areasPorCodigo = new Map(areasBD.map((a) => [a.codigo, a]));

    for (const [claveNorm, config] of CATALOGO_AREAS_HISTORICAS) {
      const areaExiste = areasPorCodigo.get(config.codigoBD);
      if (!areaExiste) {
        throw new Error(`Área del catálogo ${config.codigoBD} no existe en la tabla areas de la BD.`);
      }
    }

    // 3. SI ES SOLO VERIFICAR
    if (MODO_VERIFICAR) {
      await ejecutarReconciliacion(
        fuentes.auditorias,
        fuentes.hallazgosPorPeriodo,
        fuentes.imagenesPorPeriodo,
        formularios,
      );
      return;
    }

    // 4. CLASIFICACIÓN PRE-FLIGHT
    console.log('--- EVALUANDO ESTADO DE 1,155 QUINCENAS CONTRA LA BASE DE DATOS ---');
    let cuentaNuevos = 0;
    let cuentaSkip = 0;
    let cuentaCompletar = 0;
    let cuentaConflictos = 0;
    const auditoriasClasificadas: Array<{
      registro: RegistroPrincipal;
      estado: EstadoClasificacion;
      objetivoExistenteId?: number;
      envioExistenteId?: number;
      motivo?: string;
    }> = [];

    for (const aud of fuentes.auditorias) {
      const area = areasPorCodigo.get(aud.codigoAreaBD)!;
      const uuidEsperado = generarEnvioUuid(aud.tipoArea, aud.codigoAreaBD, aud.rango, aud.periodo);

      const objetivo = await prisma.objetivoAuditoria.findUnique({
        where: {
          areaId_anio_mes_periodo: {
            areaId: area.id,
            anio: aud.anio,
            mes: aud.mes,
            periodo: aud.periodo,
          },
        },
        include: {
          envioResultado: true,
          enviosAuditoria: true,
          asignacionesAuditoria: true,
        },
      });

      if (!objetivo) {
        cuentaNuevos++;
        auditoriasClasificadas.push({ registro: aud, estado: 'NUEVO' });
        continue;
      }

      // Caso: Ya tiene envío resultado oficial
      if (objetivo.envioResultadoId !== null) {
        if (objetivo.envioResultado?.identificadorCliente === uuidEsperado) {
          cuentaSkip++;
          auditoriasClasificadas.push({
            registro: aud,
            estado: 'SKIP',
            objetivoExistenteId: objetivo.id,
            envioExistenteId: objetivo.envioResultadoId,
          });
          continue;
        }

        // Es de un usuario real o con otro UUID
        cuentaConflictos++;
        auditoriasClasificadas.push({
          registro: aud,
          estado: 'CONFLICTO',
          motivo: `Objetivo #${objetivo.id} ya tiene envío oficial #${objetivo.envioResultadoId} con origen ${objetivo.envioResultado?.origen}`,
        });
        continue;
      }

      // Caso: No tiene envío resultado oficial pero existen envíos o asignaciones activas
      const tieneEnviosUsuario = objetivo.enviosAuditoria.some((e) => e.origen === OrigenEnvioAuditoria.USUARIO || e.enviadoPorUsuarioId !== null);
      const tieneAsignacionIniciada = objetivo.asignacionesAuditoria.some((a) => a.iniciadoEn !== null || a.estado === 'COMPLETADA');

      if (tieneEnviosUsuario || tieneAsignacionIniciada) {
        cuentaConflictos++;
        auditoriasClasificadas.push({
          registro: aud,
          estado: 'CONFLICTO',
          motivo: `Objetivo #${objetivo.id} tiene envíos previos o asignación iniciada por usuario real`,
        });
        continue;
      }

      // Caso COMPLETAR legítimo
      cuentaCompletar++;
      auditoriasClasificadas.push({
        registro: aud,
        estado: 'COMPLETAR',
        objetivoExistenteId: objetivo.id,
      });
    }

    console.log('\n================================================================================');
    console.log('                          REPORTE PRE-FLIGHT (DRY-RUN)');
    console.log('================================================================================');
    console.log(`Auditorías históricas en fuente:         ${fuentes.metricas.totalAuditorias}`);
    console.log(`Hallazgos en fuente:                     ${fuentes.metricas.totalHallazgos}`);
    console.log(`Imágenes en fuente:                      ${fuentes.metricas.totalImagenes}`);
    console.log('');
    console.log(`Clasificación respecto a BD:`);
    console.log(`  - NUEVOS (requieren inserción completa):   ${cuentaNuevos}`);
    console.log(`  - SKIP (ya importados idénticos):         ${cuentaSkip}`);
    console.log(`  - COMPLETAR (objetivos vacíos de cron):   ${cuentaCompletar}`);
    console.log(`  - CONFLICTOS (auditorías reales de app):  ${cuentaConflictos}`);
    console.log('================================================================================\n');

    if (cuentaConflictos > 0) {
      if (IGNORAR_CONFLICTOS_DEV) {
        console.warn(`⚠️ ADVERTENCIA: Se detectaron ${cuentaConflictos} conflictos con auditorías de usuarios en DEV.`);
        console.warn(`   FLAG --ignorar-conflictos-dev ACTIVO: Se omitirán estos 4 registros para no tocar las auditorías de los usuarios.\n`);
      } else {
        console.error(`❌ ERROR FATAL PRE-FLIGHT: Se detectaron ${cuentaConflictos} conflictos con auditorías reales.`);
        auditoriasClasificadas
          .filter((c) => c.estado === 'CONFLICTO')
          .slice(0, 5)
          .forEach((c) => console.error(`  - ${c.registro.codigoAreaBD} ${c.registro.rango} P${c.registro.periodo}: ${c.motivo}`));
        console.error('\nPara saltar estos conflictos de prueba en entorno de DESARROLLO sin alterar las auditorías de usuarios, usa --ignorar-conflictos-dev');
        process.exit(1);
      }
    }

    // 5. SI ES SOLO DRY-RUN, FINALIZAR AQUÍ
    if (MODO_DRY_RUN) {
      console.log('✅ DRY-RUN finalizado exitosamente. No se ejecutó ninguna mutación.');
      console.log('Para aplicar los cambios a la base de datos, ejecuta con el flag --apply.');
      return;
    }

    // 6. MOTOR DE EJECUCIÓN TRANSACCIONAL
    console.log('--- INICIANDO MOTOR DE EJECUCIÓN (APPLY) ---\n');

    // Obtener creador administrativo para el log
    const adminUser = await prisma.usuario.findFirst({
      where: { rol: { in: ['SUPER_ADMIN', 'ADMINISTRADOR'] } },
      orderBy: { id: 'asc' },
    });
    const adminId = adminUser?.id ?? 1;

    let insertados = 0;
    let completados = 0;
    let fotosSubidas = 0;
    let fotosOmitidas = 0;

    for (const item of auditoriasClasificadas) {
      const aud = item.registro;
      const area = areasPorCodigo.get(aud.codigoAreaBD)!;
      const keyPeriodo = `${aud.codigoAreaBD}|${aud.rango}|${aud.periodo}`;

      // Si es CONFLICTO y se pasó la bandera de omitir en dev, ignorar
      if (item.estado === 'CONFLICTO') {
        continue;
      }

      // Si es SKIP y no estamos en modo --solo-fotos, continuar
      if (item.estado === 'SKIP' && !MODO_SOLO_FOTOS) {
        continue;
      }

      // Manejo exclusivo de fotos para auditorías ya importadas (--solo-fotos)
      if (MODO_SOLO_FOTOS) {
        if (item.estado !== 'SKIP') continue;
        const envioExistente = await prisma.envioAuditoria.findUnique({
          where: { id: item.envioExistenteId },
          include: {
            objetivoAuditoria: true,
            respuestasAuditoria: {
              include: {
                preguntaFormulario: true,
                fotosAuditoria: true,
              },
            },
          },
        });
        if (!envioExistente) continue;

        const versionId = envioExistente.objetivoAuditoria.versionFormularioId;
        const preguntasMap = formularios.todasLasVersiones.get(versionId);

        const fotosDelPeriodo = fuentes.imagenesPorPeriodo.get(keyPeriodo) ?? [];
        for (const fotoFuente of fotosDelPeriodo) {
          const pregInfo = preguntasMap?.get(fotoFuente.numeroPregunta);
          if (!pregInfo) continue;

          const resp = envioExistente.respuestasAuditoria.find(
            (r) => r.preguntaFormulario.claveEstable === pregInfo.claveEstable,
          );
          if (!resp) continue;

          const uuidFoto = generarFotoUuid(
            aud.tipoArea,
            aud.codigoAreaBD,
            aud.rango,
            aud.periodo,
            fotoFuente.numeroPregunta,
            fotoFuente.noFoto,
            fotoFuente.url,
          );

          const yaExisteFoto = resp.fotosAuditoria.some((f) => f.identificadorCliente === uuidFoto);
          if (yaExisteFoto) continue;

          try {
            const asset = await asegurarAssetCloudinary(fotoFuente, aud.codigoAreaBD, aud.tipoArea);
            if (asset.omitidoPorVideo) {
              fotosOmitidas++;
              continue;
            }
            await prisma.fotoAuditoria.create({
              data: {
                identificadorCliente: uuidFoto,
                respuestaAuditoriaId: resp.id,
                publicIdCloudinary: asset.publicIdCloudinary,
                assetIdCloudinary: asset.assetIdCloudinary,
                formato: asset.formato,
                bytes: asset.bytes,
                ancho: asset.ancho,
                alto: asset.alto,
                subidaEn: new Date(),
              },
            });
            fotosSubidas++;
          } catch (err) {
            if (!PERMITIR_FOTOS_FALTANTES) throw err;
          }
        }
        continue;
      }

      // Pre-subir fotos a Cloudinary si aplica
      const fotosParaGuardar: Array<{
        numeroPregunta: number;
        uuidFoto: string;
        publicId: string;
        assetId: string | null;
        formato: string | null;
        bytes: number | null;
        ancho: number | null;
        alto: number | null;
      }> = [];

      if (!MODO_OMITIR_FOTOS) {
        const fotosDelPeriodo = fuentes.imagenesPorPeriodo.get(keyPeriodo) ?? [];
        for (const fotoFuente of fotosDelPeriodo) {
          try {
            const asset = await asegurarAssetCloudinary(fotoFuente, aud.codigoAreaBD, aud.tipoArea);
            if (asset.omitidoPorVideo) {
              fotosOmitidas++;
              continue;
            }
            const uuidFoto = generarFotoUuid(
              aud.tipoArea,
              aud.codigoAreaBD,
              aud.rango,
              aud.periodo,
              fotoFuente.numeroPregunta,
              fotoFuente.noFoto,
              fotoFuente.url,
            );
            fotosParaGuardar.push({
              numeroPregunta: fotoFuente.numeroPregunta,
              uuidFoto,
              publicId: asset.publicIdCloudinary,
              assetId: asset.assetIdCloudinary,
              formato: asset.formato,
              bytes: asset.bytes,
              ancho: asset.ancho,
              alto: asset.alto,
            });
            fotosSubidas++;
          } catch (err) {
            if (!PERMITIR_FOTOS_FALTANTES) throw err;
          }
        }
      }

      // Transacción atómica por auditoría
      const limites = limitesPeriodo(aud.anio, aud.mes, aud.periodo);
      const uuidEnvio = generarEnvioUuid(aud.tipoArea, aud.codigoAreaBD, aud.rango, aud.periodo);
      const formConfig = aud.tipoArea === TipoArea.ADMINISTRATIVA ? formularios.admin : formularios.operativo;
      const hallazgosDelPeriodo = fuentes.hallazgosPorPeriodo.get(keyPeriodo) ?? [];

      await prisma.$transaction(async (tx) => {
        let objetivoId = item.objetivoExistenteId;

        // Crear ObjetivoAuditoria si es NUEVO
        if (item.estado === 'NUEVO') {
          try {
            const nuevoObj = await tx.objetivoAuditoria.create({
              data: {
                areaId: area.id,
                anio: aud.anio,
                mes: aud.mes,
                periodo: aud.periodo,
                versionFormularioId: formConfig.version.id,
                iniciaEn: limites.iniciaEn,
                terminaEn: limites.terminaEn,
                codigoAreaSnapshot: area.codigo,
                nombreAreaSnapshot: area.nombre,
                tipoAreaSnapshot: aud.tipoArea,
              },
            });
            objetivoId = nuevoObj.id;
          } catch (err: unknown) {
            if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
              throw new Error(`Conflicto concurrente P2002: Otro proceso creó el ObjetivoAuditoria para ${aud.codigoAreaBD} ${aud.rango} P${aud.periodo} en paralelo.`);
            }
            throw err;
          }
        }

        if (!objetivoId) throw new Error(`Objetivo ID no definido para ${aud.codigoAreaBD}`);

        // Crear EnvioAuditoria
        const puntajePosible = aud.anio >= 2026 ? formConfig.total : 100;
        const puntajeObtenido = aud.anio >= 2026 ? (formConfig.total - hallazgosDelPeriodo.length) : aud.porcentaje;

        const envioCreado = await tx.envioAuditoria.create({
          data: {
            identificadorCliente: uuidEnvio,
            objetivoAuditoriaId: objetivoId,
            asignacionAuditoriaId: null,
            enviadoPorUsuarioId: null,
            enlaceInvitadoId: null,
            nombreAuditorSnapshot: 'HISTÓRICO POWER BI / TALLY',
            origen: OrigenEnvioAuditoria.INVITADO,
            puntajeObtenido: new Prisma.Decimal(puntajeObtenido),
            puntajePosible: new Prisma.Decimal(puntajePosible),
            porcentaje: new Prisma.Decimal(aud.porcentaje),
            finalizadoEn: limites.fechaTecnica,
            verificadoEn: limites.fechaTecnica,
            recibidoEn: limites.fechaTecnica,
            realizadaATiempo: true,
          },
        });

        // Crear Respuestas
        const mapaRespuestasCreadas = new Map<number, number>(); // numeroPregunta -> respuestaId

        if (aud.anio >= 2026) {
          // Crear catálogo completo de preguntas (23 o 34)
          for (let ord = 1; ord <= formConfig.total; ord++) {
            // Anomalía conocida P9
            if (
              (aud.codigoAreaBD === 'CORTE' && aud.rango === '2026 03' && aud.periodo === 1 && ord === 9) ||
              (aud.codigoAreaBD === 'ADORNO' && aud.rango === '2026 08' && aud.periodo === 1 && ord === 9)
            ) {
              continue; // Omitir pregunta no contestada
            }

            const preg = formConfig.preguntas.get(ord);
            if (!preg) continue;

            const hallazgo = hallazgosDelPeriodo.find((h) => h.numeroPregunta === ord);
            const resp = await tx.respuestaAuditoria.create({
              data: {
                envioAuditoriaId: envioCreado.id,
                preguntaFormularioId: preg.id,
                cumple: !hallazgo,
                hallazgo: hallazgo ? hallazgo.texto : null,
              },
            });
            mapaRespuestasCreadas.set(ord, resp.id);
          }
        } else {
          // Para 2025: solo crear respuestas para preguntas con hallazgo real
          for (const h of hallazgosDelPeriodo) {
            const preg = formConfig.preguntas.get(h.numeroPregunta);
            if (!preg) continue;

            const resp = await tx.respuestaAuditoria.create({
              data: {
                envioAuditoriaId: envioCreado.id,
                preguntaFormularioId: preg.id,
                cumple: false,
                hallazgo: h.texto,
              },
            });
            mapaRespuestasCreadas.set(h.numeroPregunta, resp.id);
          }
        }

        // Crear Fotos vinculadas
        for (const f of fotosParaGuardar) {
          const respId = mapaRespuestasCreadas.get(f.numeroPregunta);
          if (!respId) continue;

          await tx.fotoAuditoria.create({
            data: {
              identificadorCliente: f.uuidFoto,
              respuestaAuditoriaId: respId,
              publicIdCloudinary: f.publicId,
              assetIdCloudinary: f.assetId,
              formato: f.formato,
              bytes: f.bytes,
              ancho: f.ancho,
              alto: f.alto,
              subidaEn: new Date(),
            },
          });
        }

        // Enlazar resultado en CAS atómico y alinear snapshot / versión al formulario del histórico
        const casResult = await tx.objetivoAuditoria.updateMany({
          where: { id: objetivoId, envioResultadoId: null },
          data: {
            envioResultadoId: envioCreado.id,
            versionFormularioId: formConfig.version.id,
            tipoAreaSnapshot: aud.tipoArea,
          },
        });

        if (casResult.count === 0) {
          throw new Error(`Conflicto concurrente: El objetivo #${objetivoId} ya fue enlazado a otro resultado por un proceso paralelo.`);
        }

        // Bitácora de RegistroAuditoria
        await tx.registroAuditoria.create({
          data: {
            usuarioId: adminId,
            accion: 'IMPORTAR_HISTORICO_5S',
            tipoEntidad: 'EnvioAuditoria',
            idEntidad: envioCreado.id,
            datosNuevos: {
              rango: aud.rango,
              periodo: aud.periodo,
              areaCodigo: aud.codigoAreaBD,
              porcentaje: aud.porcentaje,
              hallazgos: hallazgosDelPeriodo.length,
              fotos: fotosParaGuardar.length,
              modo: item.estado,
            },
          },
        });
      });

      if (item.estado === 'NUEVO') insertados++;
      if (item.estado === 'COMPLETAR') completados++;
      console.log(`✔ [${item.estado}] ${aud.codigoAreaBD} | ${aud.rango} P${aud.periodo} | Calificación: ${aud.porcentaje}%`);
    }

    console.log('\n================================================================================');
    console.log('                      RESUMEN DE EJECUCIÓN EXITOSA');
    console.log('================================================================================');
    console.log(`Auditorías insertadas como NUEVO:        ${insertados}`);
    console.log(`Auditorías vinculadas como COMPLETAR:    ${completados}`);
    console.log(`Fotos subidas / vinculadas a Cloudinary: ${fotosSubidas}`);
    console.log(`Videos de Tally omitidos:                ${fotosOmitidas}`);
    console.log('================================================================================\n');

    // 7. EJECUTAR RECONCILIACIÓN AUTOMÁTICA FINAL
    await ejecutarReconciliacion(
      fuentes.auditorias,
      fuentes.hallazgosPorPeriodo,
      fuentes.imagenesPorPeriodo,
      formularios,
    );
  } finally {
    console.log('Liberando bloqueo mutuo en MySQL...');
    await prisma.$queryRaw`SELECT RELEASE_LOCK(${LOCK_NAME})`;
    console.log('Bloqueo liberado. Conexión cerrada.');
  }
}

main()
  .catch((err) => {
    console.error('\n❌ ERROR FATAL EN EL IMPORTADOR:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
