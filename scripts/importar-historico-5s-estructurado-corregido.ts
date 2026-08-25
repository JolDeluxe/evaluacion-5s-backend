import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';

import { cloudinary } from '../src/config/cloudinary';
import { env } from '../src/config/env';
import { prisma } from '../src/db';
import {
  AlcanceFormulario,
  EstadoCicloAuditoria,
  OrigenEnvioAuditoria,
  RolUsuario,
  TipoArea,
} from '../src/generated/prisma/enums';

const RUTA_PRINCIPAL =
  String.raw`H:\AUDITOR INTERNO\PRIVADO\5 Isaac\Auditorias 5S\Principal.txt`;

const RUTA_HALLAZGOS =
  String.raw`H:\AUDITOR INTERNO\PRIVADO\5 Isaac\Auditorias 5S\Hallazgos.txt`;

const RUTA_IMAGENES =
  String.raw`H:\AUDITOR INTERNO\PRIVADO\5 Isaac\Auditorias 5S\Imagen.txt`;

const FORMULARIO_ADMIN_SLUG =
  'evaluacion-5s-administrativa';

const FORMULARIO_OPERATIVO_SLUG =
  'evaluacion-5s-operativa';

const VERSION_HISTORICA = 1;

const APPLY = process.argv.includes('--apply');
const SKIP_PHOTOS = process.argv.includes('--skip-photos');
const ALLOW_MISSING_PHOTOS =
  process.argv.includes('--allow-missing-photos');

type TipoHistorico = '1' | '2';
type PeriodoHistorico = 1 | 2;

type CsvRow = Record<string, string>;

type ConfigTipo = {
  codigoFuente: TipoHistorico;
  tipoArea: TipoArea;
  prefijoPregunta: 'A' | 'F';
  formularioSlug: string;
  alcanceAceptado: AlcanceFormulario[];
  totalPreguntas2026: number;
};

type RegistroPrincipal = {
  areaFuente: string;
  areaNormalizada: string;
  tipo: ConfigTipo;
  anio: number;
  mes: number;
  periodo: PeriodoHistorico;
  porcentajeFraccion: number;
  porcentaje: number;
  totalMensualFuente: number | null;
  rango: string;
};

type HallazgoFuente = {
  areaNormalizada: string;
  rango: string;
  prefijo: 'A' | 'F';
  numeroPregunta: number;
  periodo: PeriodoHistorico;
  texto: string;
  claveFuente: string;
};

type ImagenFuente = {
  areaNormalizada: string;
  rango: string;
  prefijo: 'A' | 'F';
  numeroPregunta: number;
  periodo: PeriodoHistorico;
  url: string;
  numeroFoto: number;
  claveFuente: string;
};

type RespuestaPreparada = {
  numeroPregunta: number;
  cumple: boolean;
  hallazgo: string | null;
  imagenes: ImagenFuente[];
};

type FotoSubida = {
  identificadorCliente: string;
  numeroPregunta: number;
  publicIdCloudinary: string;
  assetIdCloudinary: string | null;
  formato: string | null;
  tipoMime: string | null;
  bytes: number | null;
  ancho: number | null;
  alto: number | null;
  subidaEn: Date;
};

const CONFIG_TIPOS: Record<TipoHistorico, ConfigTipo> = {
  '1': {
    codigoFuente: '1',
    tipoArea: TipoArea.ADMINISTRATIVA,
    prefijoPregunta: 'A',
    formularioSlug: FORMULARIO_ADMIN_SLUG,
    alcanceAceptado: [
      AlcanceFormulario.ADMINISTRATIVO,
      AlcanceFormulario.AMBOS,
    ],
    totalPreguntas2026: 23,
  },
  '2': {
    codigoFuente: '2',
    tipoArea: TipoArea.OPERATIVA,
    prefijoPregunta: 'F',
    formularioSlug: FORMULARIO_OPERATIVO_SLUG,
    alcanceAceptado: [
      AlcanceFormulario.OPERATIVO,
      AlcanceFormulario.AMBOS,
    ],
    totalPreguntas2026: 34,
  },
};

/*
 * Dos registros conocidos del histórico 2026 tenían 33/34 respuestas.
 * La fuente estructurada conserva el puntaje oficial, pero no marca cuál
 * pregunta quedó sin contestar. El Tally original ya confirmó que fue P9.
 *
 * NO se inventa una respuesta: P9 simplemente no se crea.
 */
const PREGUNTAS_FALTANTES_CONOCIDAS = new Map<string, Set<number>>([
  [
    [
      'OPERATIVA',
      normalizarClave('CORTE'),
      '2026 03',
      '1',
    ].join('|'),
    new Set([9]),
  ],
  [
    [
      'OPERATIVA',
      normalizarClave('ADORNO'),
      '2026 08',
      '1',
    ].join('|'),
    new Set([9]),
  ],
]);

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

function uuidDeterminista(entrada: string): string {
  const hash = createHash('sha1').update(entrada).digest();
  const bytes = Buffer.from(hash.subarray(0, 16));

  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = bytes.toString('hex');

  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-');
}

/*
 * Parser CSV pequeño pero suficiente para estos .txt:
 * - comas
 * - campos entre comillas
 * - saltos de línea dentro de comillas
 * - "" como comilla escapada
 */
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

  if (entreComillas) {
    throw new Error('CSV inválido: quedó un campo con comillas sin cerrar.');
  }

  if (campo.length > 0 || fila.length > 0) {
    fila.push(campo);
    filas.push(fila);
  }

  return filas;
}

function leerCsv(ruta: string): CsvRow[] {
  if (!existsSync(ruta)) {
    throw new Error(`No existe el archivo: ${ruta}`);
  }

  const texto = readFileSync(ruta, 'utf8');
  const filas = parseCsv(texto);

  if (filas.length < 2) {
    throw new Error(`El archivo no contiene datos: ${ruta}`);
  }

  const encabezados = filas[0].map((valor) =>
    normalizarEspacios(valor),
  );

  return filas
    .slice(1)
    .filter((fila) =>
      fila.some((valor) => normalizarEspacios(valor) !== ''),
    )
    .map((fila) => {
      const resultado: CsvRow = {};

      encabezados.forEach((encabezado, indice) => {
        resultado[encabezado] = fila[indice] ?? '';
      });

      return resultado;
    });
}

function parseFraccion(valor: string): number | null {
  const texto = normalizarEspacios(valor);

  if (!texto || texto === '-') {
    return null;
  }

  const numero = Number(texto.replace(',', '.'));

  if (!Number.isFinite(numero) || numero < 0 || numero > 1) {
    throw new Error(`Porcentaje/fracción inválido: "${valor}"`);
  }

  return numero;
}

function parseRango(valor: string): {
  anio: number;
  mes: number;
  rango: string;
} | null {
  const texto = normalizarEspacios(valor);
  const match = texto.match(/^(\d{4})\s+(\d{2})$/);

  if (!match) {
    return null;
  }

  const anio = Number(match[1]);
  const mes = Number(match[2]);

  if (mes < 1 || mes > 12) {
    throw new Error(`Mes inválido en rango "${valor}"`);
  }

  return {
    anio,
    mes,
    rango: `${anio} ${String(mes).padStart(2, '0')}`,
  };
}

function mapearNumeroPregunta(
  codigo: string,
  prefijoEsperado: 'A' | 'F',
): number {
  const limpio = normalizarEspacios(codigo).toUpperCase();

  const match = limpio.match(/^([AF])(\d{2})$/);

  if (!match) {
    throw new Error(`Código de pregunta inválido: "${codigo}"`);
  }

  const prefijo = match[1] as 'A' | 'F';

  if (prefijo !== prefijoEsperado) {
    throw new Error(
      `Pregunta ${codigo} no corresponde al prefijo ${prefijoEsperado}.`,
    );
  }

  const numeroFuente = Number(match[2]);

  if (prefijo === 'A') {
    if (numeroFuente >= 1 && numeroFuente <= 20) {
      return numeroFuente;
    }

    if (numeroFuente >= 51 && numeroFuente <= 53) {
      return numeroFuente - 30; // A51..A53 => P21..P23
    }
  }

  if (prefijo === 'F') {
    if (numeroFuente >= 1 && numeroFuente <= 31) {
      return numeroFuente;
    }

    if (numeroFuente >= 51 && numeroFuente <= 53) {
      return numeroFuente - 19; // F51..F53 => P32..P34
    }
  }

  throw new Error(
    `Código de pregunta fuera del formulario esperado: "${codigo}"`,
  );
}

function parseUnionHallazgo(
  valor: string,
): {
  area: string;
  rango: string;
} {
  const texto = normalizarEspacios(valor);
  const match = texto.match(/^(.*?)\s*\|\s*(\d{4})\s+(\d{2})$/);

  if (!match) {
    throw new Error(`Union Hallazgos inválida: "${valor}"`);
  }

  return {
    area: normalizarEspacios(match[1]),
    rango: `${match[2]} ${match[3]}`,
  };
}

function parseUnionImagen(
  valor: string,
): {
  area: string;
  rango: string;
  codigoPregunta: string;
  periodo: PeriodoHistorico;
} {
  const texto = normalizarEspacios(valor);

  const match = texto.match(
    /^(.*?)\s*\|\s*(\d{4})\s+(\d{2})\s*\|\s*([AF]\d{2})\s*\|\s*([12])$/,
  );

  if (!match) {
    throw new Error(`Union Fotografias inválida: "${valor}"`);
  }

  return {
    area: normalizarEspacios(match[1]),
    rango: `${match[2]} ${match[3]}`,
    codigoPregunta: match[4].toUpperCase(),
    periodo: Number(match[5]) as PeriodoHistorico,
  };
}

function obtenerUltimoDiaMes(anio: number, mes: number): number {
  return new Date(anio, mes, 0).getDate();
}

function limitesPeriodo(
  anio: number,
  mes: number,
  periodo: PeriodoHistorico,
) {
  const ultimoDia = obtenerUltimoDiaMes(anio, mes);

  if (periodo === 1) {
    return {
      iniciaEn: new Date(anio, mes - 1, 1, 0, 0, 0, 0),
      terminaEn: new Date(anio, mes - 1, 15, 23, 59, 59, 999),
      fechaTecnica: new Date(anio, mes - 1, 15, 12, 0, 0, 0),
    };
  }

  return {
    iniciaEn: new Date(anio, mes - 1, 16, 0, 0, 0, 0),
    terminaEn: new Date(
      anio,
      mes - 1,
      ultimoDia,
      23,
      59,
      59,
      999,
    ),
    fechaTecnica: new Date(
      anio,
      mes - 1,
      ultimoDia,
      12,
      0,
      0,
      0,
    ),
  };
}

function clavePeriodo(
  areaNormalizada: string,
  rango: string,
  prefijo: 'A' | 'F',
  periodo: PeriodoHistorico,
): string {
  return [
    areaNormalizada,
    rango,
    prefijo,
    String(periodo),
  ].join('|');
}

function clavePreguntaPeriodo(
  areaNormalizada: string,
  rango: string,
  prefijo: 'A' | 'F',
  periodo: PeriodoHistorico,
  numeroPregunta: number,
): string {
  return [
    clavePeriodo(areaNormalizada, rango, prefijo, periodo),
    numeroPregunta,
  ].join('|');
}

function leerPrincipal(): {
  periodos: RegistroPrincipal[];
  totalesMensuales: Map<string, number>;
  filasValidas: number;
} {
  const rows = leerCsv(RUTA_PRINCIPAL);

  const periodos: RegistroPrincipal[] = [];
  const totalesMensuales = new Map<string, number[]>();
  const unicidad = new Set<string>();

  let filasValidas = 0;

  for (const row of rows) {
    const rango = parseRango(row['f105 Rango'] ?? '');

    if (!rango) {
      // Principal contiene filas iniciales de plantilla sin año/mes.
      continue;
    }

    filasValidas += 1;

    const tipoFuente = normalizarEspacios(
      row['f103 Tipo'],
    ) as TipoHistorico;

    const tipo = CONFIG_TIPOS[tipoFuente];

    if (!tipo) {
      throw new Error(
        `Tipo no reconocido en Principal: "${row['f103 Tipo']}"`,
      );
    }

    const areaFuente = normalizarEspacios(row['f104 Area']);

    if (!areaFuente) {
      throw new Error(
        `Área vacía en Principal ${rango.rango}.`,
      );
    }

    const p1 = parseFraccion(row['f108 1er Periodo'] ?? '');
    const p2 = parseFraccion(row['f109 2do Periodo'] ?? '');
    const total = parseFraccion(row['f110 Totales'] ?? '');

    const valoresDisponibles = [p1, p2].filter(
      (valor): valor is number => valor !== null,
    );

    if (valoresDisponibles.length === 0) {
      if (total !== null) {
        throw new Error(
          `${areaFuente} ${rango.rango}: hay Total pero no P1/P2.`,
        );
      }

      continue;
    }

    if (total === null) {
      throw new Error(
        `${areaFuente} ${rango.rango}: hay P1/P2 pero falta Total.`,
      );
    }

    const totalCalculado =
      valoresDisponibles.reduce((suma, valor) => suma + valor, 0) /
      valoresDisponibles.length;

    if (Math.abs(totalCalculado - total) > 0.000001) {
      throw new Error(
        [
          `${areaFuente} ${rango.rango}: Total no coincide.`,
          `Fuente=${total}`,
          `Calculado=${totalCalculado}`,
        ].join(' '),
      );
    }

    const claveMes = rango.rango;
    const existentesMes = totalesMensuales.get(claveMes) ?? [];
    existentesMes.push(total);
    totalesMensuales.set(claveMes, existentesMes);

    const agregarPeriodo = (
      periodo: PeriodoHistorico,
      fraccion: number | null,
    ) => {
      if (fraccion === null) {
        return;
      }

      const areaNormalizada = normalizarClave(areaFuente);

      const clave = [
        tipo.tipoArea,
        areaNormalizada,
        rango.rango,
        periodo,
      ].join('|');

      if (unicidad.has(clave)) {
        throw new Error(
          `Periodo duplicado en Principal: ${clave}`,
        );
      }

      unicidad.add(clave);

      periodos.push({
        areaFuente,
        areaNormalizada,
        tipo,
        anio: rango.anio,
        mes: rango.mes,
        periodo,
        porcentajeFraccion: fraccion,
        porcentaje: fraccion * 100,
        totalMensualFuente: total,
        rango: rango.rango,
      });
    };

    agregarPeriodo(1, p1);
    agregarPeriodo(2, p2);
  }

  const promedios = new Map<string, number>();

  for (const [rango, valores] of totalesMensuales) {
    promedios.set(
      rango,
      valores.reduce((suma, valor) => suma + valor, 0) /
        valores.length,
    );
  }

  return {
    periodos,
    totalesMensuales: promedios,
    filasValidas,
  };
}

function leerHallazgos(): {
  porPregunta: Map<string, HallazgoFuente>;
  porPeriodo: Map<string, HallazgoFuente[]>;
  filas: number;
} {
  const rows = leerCsv(RUTA_HALLAZGOS);

  const porPregunta = new Map<string, HallazgoFuente>();
  const porPeriodo = new Map<string, HallazgoFuente[]>();

  for (const row of rows) {
    const union = parseUnionHallazgo(
      row['f001 Union Hallazgos'] ?? '',
    );

    const codigoPregunta = normalizarEspacios(
      row['f201 Orden'],
    ).toUpperCase();

    const prefijo = codigoPregunta[0] as 'A' | 'F';

    if (prefijo !== 'A' && prefijo !== 'F') {
      throw new Error(
        `Prefijo de pregunta inválido en Hallazgos: ${codigoPregunta}`,
      );
    }

    const numeroPregunta = mapearNumeroPregunta(
      codigoPregunta,
      prefijo,
    );

    const selector = Number(
      normalizarEspacios(row['f202 Selector']),
    );

    if (selector !== 1 && selector !== 2) {
      throw new Error(
        `Selector inválido en Hallazgos: "${row['f202 Selector']}"`,
      );
    }

    const texto = String(row['f203 Hallazgo'] ?? '').trim();

    if (!texto) {
      throw new Error(
        `Hallazgo vacío: ${row['f002 Union Fotografias']}`,
      );
    }

    const hallazgo: HallazgoFuente = {
      areaNormalizada: normalizarClave(union.area),
      rango: union.rango,
      prefijo,
      numeroPregunta,
      periodo: selector as PeriodoHistorico,
      texto,
      claveFuente: normalizarEspacios(
        row['f002 Union Fotografias'],
      ),
    };

    const key = clavePreguntaPeriodo(
      hallazgo.areaNormalizada,
      hallazgo.rango,
      hallazgo.prefijo,
      hallazgo.periodo,
      hallazgo.numeroPregunta,
    );

    if (porPregunta.has(key)) {
      throw new Error(
        `Hallazgo duplicado para la misma pregunta/periodo: ${key}`,
      );
    }

    porPregunta.set(key, hallazgo);

    const keyPeriodo = clavePeriodo(
      hallazgo.areaNormalizada,
      hallazgo.rango,
      hallazgo.prefijo,
      hallazgo.periodo,
    );

    const actuales = porPeriodo.get(keyPeriodo) ?? [];
    actuales.push(hallazgo);
    porPeriodo.set(keyPeriodo, actuales);
  }

  return {
    porPregunta,
    porPeriodo,
    filas: rows.length,
  };
}

function leerImagenes(): {
  porPregunta: Map<string, ImagenFuente[]>;
  porPeriodo: Map<string, ImagenFuente[]>;
  filas: number;
} {
  const rows = leerCsv(RUTA_IMAGENES);

  const porPregunta = new Map<string, ImagenFuente[]>();
  const porPeriodo = new Map<string, ImagenFuente[]>();

  for (const row of rows) {
    const url = normalizarEspacios(row['f301 Fotografia']);

    if (!/^https?:\/\//i.test(url)) {
      throw new Error(
        `URL de imagen inválida: "${row['f301 Fotografia']}"`,
      );
    }

    const union = parseUnionImagen(
      row['f002 Union Fotografias'] ?? '',
    );

    const prefijo = union.codigoPregunta[0] as 'A' | 'F';

    const numeroPregunta = mapearNumeroPregunta(
      union.codigoPregunta,
      prefijo,
    );

    const numeroFotoRaw = Number(
      normalizarEspacios(row['f302 NoFoto']),
    );

    const numeroFoto =
      Number.isInteger(numeroFotoRaw) && numeroFotoRaw > 0
        ? numeroFotoRaw
        : 1;

    const imagen: ImagenFuente = {
      areaNormalizada: normalizarClave(union.area),
      rango: union.rango,
      prefijo,
      numeroPregunta,
      periodo: union.periodo,
      url,
      numeroFoto,
      claveFuente: normalizarEspacios(
        row['f002 Union Fotografias'],
      ),
    };

    const keyPregunta = clavePreguntaPeriodo(
      imagen.areaNormalizada,
      imagen.rango,
      imagen.prefijo,
      imagen.periodo,
      imagen.numeroPregunta,
    );

    const actualesPregunta = porPregunta.get(keyPregunta) ?? [];
    actualesPregunta.push(imagen);
    porPregunta.set(keyPregunta, actualesPregunta);

    const keyPeriodo = clavePeriodo(
      imagen.areaNormalizada,
      imagen.rango,
      imagen.prefijo,
      imagen.periodo,
    );

    const actualesPeriodo = porPeriodo.get(keyPeriodo) ?? [];
    actualesPeriodo.push(imagen);
    porPeriodo.set(keyPeriodo, actualesPeriodo);
  }

  for (const imagenes of porPregunta.values()) {
    imagenes.sort((a, b) => a.numeroFoto - b.numeroFoto);
  }

  return {
    porPregunta,
    porPeriodo,
    filas: rows.length,
  };
}

function preguntasFaltantesConocidas(
  registro: RegistroPrincipal,
): Set<number> {
  const key = [
    registro.tipo.tipoArea,
    registro.areaNormalizada,
    registro.rango,
    registro.periodo,
  ].join('|');

  return PREGUNTAS_FALTANTES_CONOCIDAS.get(key) ?? new Set();
}

function prepararRespuestas(
  registro: RegistroPrincipal,
  hallazgos: ReturnType<typeof leerHallazgos>,
  imagenes: ReturnType<typeof leerImagenes>,
): {
  respuestas: RespuestaPreparada[];
  detalle: 'COMPLETO_2026' | 'PARCIAL_2025' | 'SIN_DETALLE';
  imagenesSinRespuesta: ImagenFuente[];
} {
  const prefijo = registro.tipo.prefijoPregunta;

  const keyPeriodo = clavePeriodo(
    registro.areaNormalizada,
    registro.rango,
    prefijo,
    registro.periodo,
  );

  const hallazgosPeriodo =
    hallazgos.porPeriodo.get(keyPeriodo) ?? [];

  const imagenesPeriodo =
    imagenes.porPeriodo.get(keyPeriodo) ?? [];

  const faltantes = preguntasFaltantesConocidas(registro);

  /*
   * 2026 sí permite reconstruir el detalle:
   * la fuente estructurada + el puntaje oficial cuadran con las 23/34
   * preguntas, salvo las dos P9 faltantes ya conocidas.
   */
  if (registro.anio >= 2026) {
    const respuestas: RespuestaPreparada[] = [];

    for (
      let numero = 1;
      numero <= registro.tipo.totalPreguntas2026;
      numero += 1
    ) {
      if (faltantes.has(numero)) {
        continue;
      }

      const keyPregunta = clavePreguntaPeriodo(
        registro.areaNormalizada,
        registro.rango,
        prefijo,
        registro.periodo,
        numero,
      );

      const hallazgo = hallazgos.porPregunta.get(keyPregunta);

      respuestas.push({
        numeroPregunta: numero,
        cumple: !hallazgo,
        hallazgo: hallazgo?.texto ?? null,
        imagenes: imagenes.porPregunta.get(keyPregunta) ?? [],
      });
    }

    const si = respuestas.filter((respuesta) => respuesta.cumple).length;
    const esperado =
      registro.porcentajeFraccion *
      registro.tipo.totalPreguntas2026;

    if (Math.abs(si - esperado) > 0.001) {
      throw new Error(
        [
          `${registro.areaFuente} ${registro.rango} P${registro.periodo}`,
          `no permite reconstruir respuestas 2026.`,
          `SÍ reconstruidos=${si}`,
          `SÍ esperados=${esperado}`,
          `hallazgos=${hallazgosPeriodo.length}`,
          `faltantes=${[...faltantes].join(',') || 'ninguno'}`,
        ].join(' | '),
      );
    }

    return {
      respuestas,
      detalle: 'COMPLETO_2026',
      imagenesSinRespuesta: [],
    };
  }

  /*
   * En 2025 Principal contiene el resultado oficial, pero Hallazgos no
   * permite reconstruir de forma completa todas las respuestas.
   * Por seguridad NO inventamos SÍ.
   *
   * Conservamos únicamente los NO/hallazgos explícitos cuya familia A/F
   * coincide con el tipo de Principal. Las fotos se adjuntan a esos NO.
   */
  if (hallazgosPeriodo.length > 0) {
    const respuestas = hallazgosPeriodo
      .sort((a, b) => a.numeroPregunta - b.numeroPregunta)
      .map((hallazgo) => {
        const keyPregunta = clavePreguntaPeriodo(
          registro.areaNormalizada,
          registro.rango,
          prefijo,
          registro.periodo,
          hallazgo.numeroPregunta,
        );

        return {
          numeroPregunta: hallazgo.numeroPregunta,
          cumple: false,
          hallazgo: hallazgo.texto,
          imagenes: imagenes.porPregunta.get(keyPregunta) ?? [],
        };
      });

    const preguntasConRespuesta = new Set(
      respuestas.map((respuesta) => respuesta.numeroPregunta),
    );

    const imagenesSinRespuesta = imagenesPeriodo.filter(
      (imagen) => !preguntasConRespuesta.has(imagen.numeroPregunta),
    );

    return {
      respuestas,
      detalle: 'PARCIAL_2025',
      imagenesSinRespuesta,
    };
  }

  return {
    respuestas: [],
    detalle: 'SIN_DETALLE',
    imagenesSinRespuesta: imagenesPeriodo,
  };
}

async function obtenerCreador() {
  const superAdmin = await prisma.usuario.findFirst({
    where: {
      activo: true,
      rol: RolUsuario.SUPER_ADMIN,
    },
    select: {
      id: true,
      nombre: true,
      rol: true,
    },
  });

  if (superAdmin) {
    return superAdmin;
  }

  const administrador = await prisma.usuario.findFirst({
    where: {
      activo: true,
      rol: RolUsuario.ADMINISTRADOR,
    },
    select: {
      id: true,
      nombre: true,
      rol: true,
    },
  });

  if (!administrador) {
    throw new Error(
      'No existe SUPER_ADMIN ni ADMINISTRADOR activo.',
    );
  }

  return administrador;
}

async function obtenerVersion(
  config: ConfigTipo,
) {
  const formulario = await prisma.formulario.findUnique({
    where: {
      slug: config.formularioSlug,
    },
    include: {
      versiones: {
        where: {
          numeroVersion: VERSION_HISTORICA,
        },
        include: {
          secciones: {
            orderBy: {
              orden: 'asc',
            },
            include: {
              preguntas: {
                orderBy: {
                  orden: 'asc',
                },
              },
            },
          },
        },
      },
    },
  });

  if (!formulario) {
    throw new Error(
      `No existe formulario: ${config.formularioSlug}`,
    );
  }

  if (!config.alcanceAceptado.includes(formulario.alcance)) {
    throw new Error(
      `El formulario ${config.formularioSlug} tiene alcance incorrecto.`,
    );
  }

  const version = formulario.versiones[0];

  if (!version) {
    throw new Error(
      `No existe V${VERSION_HISTORICA} de ${config.formularioSlug}.`,
    );
  }

  /*
   * IMPORTANTE:
   *
   * PreguntaFormulario.orden pertenece a la pregunta dentro de su sección.
   * No podemos asumir que sea un número global P1..P23/P34.
   *
   * La identidad histórica de P1..Pn se reconstruye recorriendo:
   *   secciones por SeccionFormulario.orden
   *   +
   *   preguntas de cada sección por PreguntaFormulario.orden
   *
   * Este es además el mismo criterio que usaban los importadores anteriores,
   * que accedían a la lista aplanada por posición.
   */
  const preguntas = version.secciones.flatMap((seccion) =>
    [...seccion.preguntas].sort(
      (a, b) =>
        a.orden - b.orden ||
        a.id - b.id,
    ),
  );

  if (preguntas.length !== config.totalPreguntas2026) {
    throw new Error(
      `${config.formularioSlug} V1 tiene ${preguntas.length} preguntas; se esperaban ${config.totalPreguntas2026}.`,
    );
  }

  /*
   * Mapa CANÓNICO histórico:
   * índice 0 = P1, índice 1 = P2, etc.
   *
   * No usamos pregunta.orden como clave global porque ese campo puede
   * reiniciarse o tener otra convención dentro de cada sección.
   */
  const preguntasPorNumero = new Map(
    preguntas.map((pregunta, indice) => [
      indice + 1,
      pregunta,
    ]),
  );

  return {
    formulario,
    version,
    preguntasPorOrden: preguntasPorNumero,
  };
}

async function resolverAreas(
  periodos: RegistroPrincipal[],
) {
  const areas = await prisma.area.findMany({
    select: {
      id: true,
      codigo: true,
      nombre: true,
      tipo: true,
      activo: true,
    },
  });

  const mapa = new Map<
    string,
    (typeof areas)[number]
  >();

  for (const registro of periodos) {
    const key = [
      registro.tipo.tipoArea,
      registro.areaNormalizada,
    ].join('|');

    if (mapa.has(key)) {
      continue;
    }

    const candidatas = areas.filter(
      (area) =>
        area.tipo === registro.tipo.tipoArea &&
        normalizarClave(area.nombre) === registro.areaNormalizada,
    );

    if (candidatas.length !== 1) {
      throw new Error(
        [
          `No se pudo resolver área de forma inequívoca:`,
          `fuente="${registro.areaFuente}"`,
          `tipo=${registro.tipo.tipoArea}`,
          `coincidencias=${candidatas.length}`,
        ].join(' '),
      );
    }

    mapa.set(key, candidatas[0]);
  }

  return mapa;
}

function verificarCloudinary(totalImagenes: number) {
  if (SKIP_PHOTOS || totalImagenes === 0) {
    return;
  }

  const enabled = env.CLOUDINARY_ENABLED;
  const cloudName = Boolean(process.env.CLOUDINARY_CLOUD_NAME);
  const apiKey = Boolean(process.env.CLOUDINARY_API_KEY);
  const apiSecret = Boolean(process.env.CLOUDINARY_API_SECRET);

  if (!enabled || !cloudName || !apiKey || !apiSecret) {
    throw new Error(
      [
        `Hay ${totalImagenes} imágenes en la fuente.`,
        `Cloudinary no está completamente configurado.`,
        `enabled=${enabled}`,
        `cloudName=${cloudName}`,
        `apiKey=${apiKey}`,
        `apiSecret=${apiSecret}`,
      ].join(' '),
    );
  }
}

function mensajeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'string') {
    return error;
  }

  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

async function subirImagen(
  registro: RegistroPrincipal,
  areaCodigo: string,
  imagen: ImagenFuente,
): Promise<
  | {
      omitida: true;
      motivo: string;
    }
  | {
      omitida: false;
      foto: FotoSubida;
    }
> {
  const identificadorCliente = uuidDeterminista(
    [
      'POWERBI_ESTRUCTURADO_FOTO',
      registro.tipo.tipoArea,
      areaCodigo,
      registro.rango,
      registro.periodo,
      imagen.numeroPregunta,
      imagen.numeroFoto,
      imagen.url,
    ].join('|'),
  );

  const publicId =
    `estructurado-${identificadorCliente.replace(/-/g, '')}`;

  const folder = [
    'encuestas-5s',
    'historico-estructurado',
    String(registro.anio),
    String(registro.mes).padStart(2, '0'),
    `periodo-${registro.periodo}`,
    areaCodigo.toLowerCase(),
    `pregunta-${imagen.numeroPregunta}`,
  ].join('/');

  try {
    const resultado = await cloudinary.uploader.upload(
      imagen.url,
      {
        resource_type: 'image',
        folder,
        public_id: publicId,
        overwrite: true,
        unique_filename: false,
        use_filename: false,
      },
    );

    return {
      omitida: false,
      foto: {
        identificadorCliente,
        numeroPregunta: imagen.numeroPregunta,
        publicIdCloudinary: resultado.public_id,
        assetIdCloudinary: resultado.asset_id ?? null,
        formato: resultado.format ?? null,
        tipoMime: null,
        bytes:
          typeof resultado.bytes === 'number'
            ? resultado.bytes
            : null,
        ancho:
          typeof resultado.width === 'number'
            ? resultado.width
            : null,
        alto:
          typeof resultado.height === 'number'
            ? resultado.height
            : null,
        subidaEn: new Date(),
      },
    };
  } catch (errorCloudinary) {
    /*
     * La importación operativa anterior encontró videos dentro de Tally.
     * El usuario decidió omitir videos históricos.
     *
     * Sólo si Cloudinary rechaza el archivo como imagen consultamos el
     * content-type. No imprimimos la URL firmada.
     */
    let response: Response;

    try {
      response = await fetch(imagen.url, {
        method: 'GET',
        redirect: 'follow',
        headers: {
          Accept: '*/*',
          'User-Agent':
            'Encuestas5S-HistoricoEstructurado/1.0',
        },
      });
    } catch (errorFetch) {
      throw new Error(
        [
          `Cloudinary: ${mensajeError(errorCloudinary)}`,
          `Tally fetch: ${mensajeError(errorFetch)}`,
        ].join(' | '),
        { cause: errorFetch },
      );
    }

    if (!response.ok) {
      throw new Error(
        [
          `Cloudinary: ${mensajeError(errorCloudinary)}`,
          `Tally HTTP ${response.status} ${response.statusText}`,
        ].join(' | '),
        { cause: errorCloudinary },
      );
    }

    const contentType = (
      response.headers.get('content-type') ?? ''
    )
      .split(';')[0]
      .trim()
      .toLowerCase();

    try {
      await response.body?.cancel();
    } catch {
      // No afecta la importación.
    }

    if (contentType.startsWith('video/')) {
      return {
        omitida: true,
        motivo: `video histórico (${contentType})`,
      };
    }

    throw new Error(
      [
        `Cloudinary no pudo importar la imagen: ${mensajeError(
          errorCloudinary,
        )}`,
        `content-type=${contentType || 'desconocido'}`,
      ].join(' | '),
      { cause: errorCloudinary },
    );
  }
}

async function asegurarCiclo(
  registro: RegistroPrincipal,
  creadoPorId: number,
) {
  const limites = limitesPeriodo(
    registro.anio,
    registro.mes,
    registro.periodo,
  );

  let ciclo = await prisma.cicloAuditoria.findFirst({
    where: {
      anio: registro.anio,
      mes: registro.mes,
      numeroCorte: registro.periodo,
    },
  });

  if (!ciclo) {
    ciclo = await prisma.cicloAuditoria.create({
      data: {
        anio: registro.anio,
        mes: registro.mes,
        numeroCorte: registro.periodo,
        nombre: `HISTÓRICO ESTRUCTURADO ${registro.anio}-${String(
          registro.mes,
        ).padStart(2, '0')} P${registro.periodo}`,
        estado: EstadoCicloAuditoria.ARCHIVADO,
        iniciaEn: limites.iniciaEn,
        terminaEn: limites.terminaEn,
        publicadoEn: limites.iniciaEn,
        cerradoEn: limites.terminaEn,
        creadoPorId,
      },
    });
  }

  return {
    ciclo,
    limites,
  };
}

async function asegurarFormularioCiclo(
  cicloId: number,
  config: ConfigTipo,
  versionFormularioId: number,
) {
  const existente = await prisma.formularioCiclo.findFirst({
    where: {
      cicloAuditoriaId: cicloId,
      tipoArea: config.tipoArea,
    },
  });

  if (existente) {
    if (
      existente.versionFormularioId !== versionFormularioId
    ) {
      throw new Error(
        `Ciclo #${cicloId} ya apunta a otra versión ${config.tipoArea}.`,
      );
    }

    return existente;
  }

  return prisma.formularioCiclo.create({
    data: {
      cicloAuditoriaId: cicloId,
      tipoArea: config.tipoArea,
      versionFormularioId,
    },
  });
}

function scoreSnapshot(
  registro: RegistroPrincipal,
  respuestas: RespuestaPreparada[],
): {
  puntajeObtenido: number;
  puntajePosible: number;
} {
  /*
   * Para 2026 los porcentajes estructurados corresponden a las 23/34
   * preguntas actuales y se validaron contra Hallazgos.
   */
  if (registro.anio >= 2026) {
    return {
      puntajeObtenido: respuestas.filter(
        (respuesta) => respuesta.cumple,
      ).length,
      puntajePosible: registro.tipo.totalPreguntas2026,
    };
  }

  /*
   * Para 2025 Principal es la autoridad del porcentaje, pero la fuente
   * estructurada no permite reconstruir de forma confiable el denominador
   * histórico en todos los meses. Guardamos el snapshot como porcentaje
   * sobre 100 para NO inventar un número de preguntas.
   */
  return {
    puntajeObtenido: registro.porcentaje,
    puntajePosible: 100,
  };
}

function clavesPeriodoPrincipal(
  periodos: RegistroPrincipal[],
): Set<string> {
  return new Set(
    periodos.map((registro) =>
      clavePeriodo(
        registro.areaNormalizada,
        registro.rango,
        registro.tipo.prefijoPregunta,
        registro.periodo,
      ),
    ),
  );
}

async function main() {
  console.log(`Modo: ${APPLY ? 'APPLY' : 'DRY RUN'}`);
  console.log(`Principal: ${RUTA_PRINCIPAL}`);
  console.log(`Hallazgos: ${RUTA_HALLAZGOS}`);
  console.log(`Imagen: ${RUTA_IMAGENES}`);

  const principal = leerPrincipal();
  const hallazgos = leerHallazgos();
  const imagenes = leerImagenes();

  const creador = await obtenerCreador();

  const versionAdmin = await obtenerVersion(
    CONFIG_TIPOS['1'],
  );

  const versionOperativa = await obtenerVersion(
    CONFIG_TIPOS['2'],
  );

  const areas = await resolverAreas(principal.periodos);

  verificarCloudinary(imagenes.filas);

  const periodosPrincipal = clavesPeriodoPrincipal(
    principal.periodos,
  );

  const periodosHallazgoNoMapeados = [
    ...hallazgos.porPeriodo.keys(),
  ].filter((key) => !periodosPrincipal.has(key));

  const periodosImagenNoMapeados = [
    ...imagenes.porPeriodo.keys(),
  ].filter((key) => !periodosPrincipal.has(key));

  let completos2026 = 0;
  let parciales2025 = 0;
  let sinDetalle = 0;
  let imagenesNoVinculables2025 = 0;

  for (const registro of principal.periodos) {
    const preparado = prepararRespuestas(
      registro,
      hallazgos,
      imagenes,
    );

    if (preparado.detalle === 'COMPLETO_2026') {
      completos2026 += 1;
    } else if (preparado.detalle === 'PARCIAL_2025') {
      parciales2025 += 1;
    } else {
      sinDetalle += 1;
    }

    imagenesNoVinculables2025 +=
      preparado.imagenesSinRespuesta.length;
  }

  console.log('');
  console.log('====================================================');
  console.log(' PREFLIGHT HISTÓRICO ESTRUCTURADO');
  console.log('====================================================');
  console.log(`Filas válidas Principal: ${principal.filasValidas}`);
  console.log(`Periodos con resultado: ${principal.periodos.length}`);
  console.log(`Hallazgos: ${hallazgos.filas}`);
  console.log(`Imágenes/evidencias: ${imagenes.filas}`);
  console.log(`Detalle completo reconstruible 2026: ${completos2026}`);
  console.log(`Detalle parcial conservable 2025: ${parciales2025}`);
  console.log(`Periodos sin detalle: ${sinDetalle}`);
  console.log(
    `Imágenes 2025 sin respuesta/hallazgo vinculable: ${imagenesNoVinculables2025}`,
  );
  console.log(
    `Periodos de Hallazgos sin periodo equivalente en Principal: ${periodosHallazgoNoMapeados.length}`,
  );
  console.log(
    `Periodos de Imagen sin periodo equivalente en Principal: ${periodosImagenNoMapeados.length}`,
  );

  if (periodosHallazgoNoMapeados.length > 0) {
    console.log('');
    console.log(
      '⚠️ Hallazgos no mapeados (se conserva Principal como autoridad):',
    );

    for (const key of periodosHallazgoNoMapeados) {
      console.log(`- ${key}`);
    }
  }

  if (periodosImagenNoMapeados.length > 0) {
    console.log('');
    console.log(
      '⚠️ Imágenes no mapeadas (no se inventará un resultado que Principal no tenga):',
    );

    for (const key of periodosImagenNoMapeados) {
      console.log(`- ${key}`);
    }
  }

  console.log(`Áreas resueltas: ${areas.size}`);
  console.log(
    `Formulario admin: V${versionAdmin.version.numeroVersion} (${versionAdmin.preguntasPorOrden.size} preguntas)`,
  );
  console.log(
    `Formulario operativo: V${versionOperativa.version.numeroVersion} (${versionOperativa.preguntasPorOrden.size} preguntas)`,
  );
  console.log(`Creador técnico: ${creador.nombre} (${creador.rol})`);

  console.log('');
  console.log('PROMEDIO GLOBAL SEGÚN PRINCIPAL:');

  for (
    const [rango, promedio]
    of [...principal.totalesMensuales.entries()].sort(
      ([a], [b]) => a.localeCompare(b),
    )
  ) {
    console.log(
      `- ${rango}: ${(promedio * 100).toFixed(4)}%`,
    );
  }

  if (!APPLY) {
    console.log('');
    console.log('✅ DRY RUN terminado.');
    console.log('✅ No se modificó MySQL.');
    console.log('✅ No se modificó Cloudinary.');
    console.log('');
    console.log(
      'Cuando revises el preflight, ejecuta el mismo script agregando --apply.',
    );
    return;
  }

  let creados = 0;
  let existentes = 0;
  let respuestasCreadas = 0;
  let fotosCreadas = 0;
  let videosOmitidos = 0;
  let fotosOmitidasPorFaltaDetalle = 0;
  let fallidos = 0;

  const ciclosCache = new Map<
    string,
    Awaited<ReturnType<typeof asegurarCiclo>>
  >();

  const formularioCicloCache = new Map<
    string,
    Awaited<ReturnType<typeof asegurarFormularioCiclo>>
  >();

  const ordenados = [...principal.periodos].sort(
    (a, b) =>
      a.anio - b.anio ||
      a.mes - b.mes ||
      a.periodo - b.periodo ||
      a.tipo.codigoFuente.localeCompare(b.tipo.codigoFuente) ||
      a.areaFuente.localeCompare(b.areaFuente),
  );

  for (const registro of ordenados) {
    const keyArea = [
      registro.tipo.tipoArea,
      registro.areaNormalizada,
    ].join('|');

    const area = areas.get(keyArea);

    if (!area) {
      throw new Error(
        `Área no encontrada después del preflight: ${keyArea}`,
      );
    }

    const identificadorEnvio = uuidDeterminista(
      [
        'POWERBI_ESTRUCTURADO_ENVIO',
        registro.tipo.tipoArea,
        area.codigo,
        registro.rango,
        registro.periodo,
      ].join('|'),
    );

    const existente = await prisma.envioAuditoria.findUnique({
      where: {
        identificadorCliente: identificadorEnvio,
      },
      select: {
        id: true,
      },
    });

    if (existente) {
      existentes += 1;
      console.log(
        `↪ ${registro.rango} P${registro.periodo} · ${area.nombre} · ya existe envío #${existente.id}`,
      );
      continue;
    }

    try {
      const preparado = prepararRespuestas(
        registro,
        hallazgos,
        imagenes,
      );

      fotosOmitidasPorFaltaDetalle +=
        preparado.imagenesSinRespuesta.length;

      const version =
        registro.tipo.codigoFuente === '1'
          ? versionAdmin
          : versionOperativa;

      const fotosSubidas: FotoSubida[] = [];

      if (!SKIP_PHOTOS) {
        for (const respuesta of preparado.respuestas) {
          for (const imagen of respuesta.imagenes) {
            try {
              const subida = await subirImagen(
                registro,
                area.codigo,
                imagen,
              );

              if (subida.omitida) {
                videosOmitidos += 1;
                console.warn(
                  `🎥 ${registro.rango} P${registro.periodo} · ${area.nombre} · P${respuesta.numeroPregunta} · omitido: ${subida.motivo}`,
                );
                continue;
              }

              fotosSubidas.push(subida.foto);
            } catch (errorFoto) {
              if (!ALLOW_MISSING_PHOTOS) {
                throw errorFoto;
              }

              console.warn(
                `⚠️ ${registro.rango} P${registro.periodo} · ${area.nombre} · P${respuesta.numeroPregunta} · foto omitida por --allow-missing-photos: ${mensajeError(
                  errorFoto,
                )}`,
              );
            }
          }
        }
      }

      const cicloKey = [
        registro.anio,
        registro.mes,
        registro.periodo,
      ].join('|');

      let contextoCiclo = ciclosCache.get(cicloKey);

      if (!contextoCiclo) {
        contextoCiclo = await asegurarCiclo(
          registro,
          creador.id,
        );

        ciclosCache.set(cicloKey, contextoCiclo);
      }

      const formularioCicloKey = [
        contextoCiclo.ciclo.id,
        registro.tipo.tipoArea,
      ].join('|');

      let formularioCiclo =
        formularioCicloCache.get(formularioCicloKey);

      if (!formularioCiclo) {
        formularioCiclo = await asegurarFormularioCiclo(
          contextoCiclo.ciclo.id,
          registro.tipo,
          version.version.id,
        );

        formularioCicloCache.set(
          formularioCicloKey,
          formularioCiclo,
        );
      }

      const score = scoreSnapshot(
        registro,
        preparado.respuestas,
      );

      await prisma.$transaction(
        async (tx) => {
          let objetivo = await tx.objetivoAuditoria.findFirst({
            where: {
              cicloAuditoriaId: contextoCiclo!.ciclo.id,
              areaId: area.id,
            },
          });

          if (!objetivo) {
            objetivo = await tx.objetivoAuditoria.create({
              data: {
                cicloAuditoriaId: contextoCiclo!.ciclo.id,
                formularioCicloId: formularioCiclo!.id,
                areaId: area.id,
                codigoAreaSnapshot: area.codigo,
                nombreAreaSnapshot: area.nombre,
                tipoAreaSnapshot: registro.tipo.tipoArea,
              },
            });
          }

          if (objetivo.envioResultadoId !== null) {
            throw new Error(
              `Objetivo #${objetivo.id} ya tiene envioResultadoId=${objetivo.envioResultadoId}. Limpia la BD antes de esta importación.`,
            );
          }

          const envio = await tx.envioAuditoria.create({
            data: {
              identificadorCliente: identificadorEnvio,
              objetivoAuditoriaId: objetivo.id,
              asignacionAuditoriaId: null,
              enviadoPorUsuarioId: null,
              enlaceInvitadoId: null,

              /*
               * Principal/Hallazgos/Imagen NO contienen el nombre real
               * del auditor. No se inventa una persona.
               */
              nombreAuditorSnapshot:
                'HISTÓRICO POWER BI / TALLY',

              origen: OrigenEnvioAuditoria.INVITADO,

              puntajeObtenido:
                score.puntajeObtenido.toFixed(4),

              puntajePosible:
                score.puntajePosible.toFixed(4),

              /*
               * FUENTE DE VERDAD:
               * f108/f109 de Principal.
               */
              porcentaje:
                registro.porcentaje.toFixed(4),

              /*
               * Los tres TXT no incluyen fecha/hora real.
               * El schema obliga estos timestamps, por eso usamos el
               * cierre del periodo como FECHA TÉCNICA.
               *
               * Esto NO afirma que la auditoría se haya realizado
               * exactamente ese día ni que existiera QR.
               */
              finalizadoEn: contextoCiclo!.limites.fechaTecnica,
              verificadoEn: contextoCiclo!.limites.fechaTecnica,
              recibidoEn: contextoCiclo!.limites.fechaTecnica,
            },
          });

          const respuestaIdPorNumero = new Map<number, number>();

          for (const respuesta of preparado.respuestas) {
            const pregunta =
              version.preguntasPorOrden.get(
                respuesta.numeroPregunta,
              );

            if (!pregunta) {
              throw new Error(
                `No existe PreguntaFormulario P${respuesta.numeroPregunta} para ${registro.tipo.formularioSlug}.`,
              );
            }

            const creada = await tx.respuestaAuditoria.create({
              data: {
                envioAuditoriaId: envio.id,
                preguntaFormularioId: pregunta.id,
                cumple: respuesta.cumple,
                hallazgo: respuesta.hallazgo,
              },
            });

            respuestaIdPorNumero.set(
              respuesta.numeroPregunta,
              creada.id,
            );

            respuestasCreadas += 1;
          }

          for (const foto of fotosSubidas) {
            const respuestaId = respuestaIdPorNumero.get(
              foto.numeroPregunta,
            );

            if (!respuestaId) {
              throw new Error(
                `Foto P${foto.numeroPregunta} sin RespuestaAuditoria asociada.`,
              );
            }

            await tx.fotoAuditoria.create({
              data: {
                identificadorCliente:
                  foto.identificadorCliente,
                respuestaAuditoriaId: respuestaId,
                publicIdCloudinary:
                  foto.publicIdCloudinary,
                assetIdCloudinary:
                  foto.assetIdCloudinary,
                formato: foto.formato,
                tipoMime: foto.tipoMime,
                bytes: foto.bytes,
                ancho: foto.ancho,
                alto: foto.alto,
                capturadaEn: null,
                subidaEn: foto.subidaEn,
              },
            });

            fotosCreadas += 1;
          }

          /*
           * Principal YA viene estructurado por 1er/2do periodo.
           * Hay exactamente un resultado canónico por objetivo.
           * Por eso se marca oficial inmediatamente.
           */
          await tx.objetivoAuditoria.update({
            where: {
              id: objetivo.id,
            },
            data: {
              envioResultadoId: envio.id,
            },
          });

          await tx.registroAuditoria.create({
            data: {
              usuarioId: creador.id,
              accion:
                'IMPORTAR_HISTORICO_5S_ESTRUCTURADO',
              tipoEntidad: 'EnvioAuditoria',
              idEntidad: envio.id,
              datosNuevos: {
                fuente: 'PRINCIPAL_HALLAZGOS_IMAGEN',
                rango: registro.rango,
                periodo: registro.periodo,
                areaFuente: registro.areaFuente,
                areaId: area.id,
                tipoArea: registro.tipo.tipoArea,
                porcentajeFuente:
                  registro.porcentaje,
                totalMensualFuente:
                  registro.totalMensualFuente === null
                    ? null
                    : registro.totalMensualFuente * 100,
                detalle: preparado.detalle,
                fechaRealDisponible: false,
                fechaTecnicaUsada:
                  contextoCiclo!.limites.fechaTecnica.toISOString(),
                auditorRealDisponible: false,
                preguntasFaltantesConocidas: [
                  ...preguntasFaltantesConocidas(registro),
                ],
                videosHistoricos:
                  'Se omiten por decisión de negocio',
              },
            },
          });
        },
        {
          maxWait: 10_000,
          timeout: 60_000,
        },
      );

      creados += 1;

      console.log(
        `✅ ${registro.rango} P${registro.periodo} · ${area.nombre} · ${registro.porcentaje.toFixed(4)}% · ${preparado.detalle}`,
      );
    } catch (error) {
      fallidos += 1;

      console.error(
        `❌ ${registro.rango} P${registro.periodo} · ${area.nombre}: ${mensajeError(
          error,
        )}`,
      );

      if (!ALLOW_MISSING_PHOTOS) {
        // La fila queda sin insertar. El script es idempotente y se puede reintentar.
      }
    }
  }

  console.log('');
  console.log('====================================================');
  console.log(' IMPORTACIÓN TERMINADA');
  console.log('====================================================');
  console.log(`Envíos creados: ${creados}`);
  console.log(`Ya existentes: ${existentes}`);
  console.log(`Fallidos: ${fallidos}`);
  console.log(`Respuestas creadas: ${respuestasCreadas}`);
  console.log(`Fotos creadas: ${fotosCreadas}`);
  console.log(`Videos omitidos: ${videosOmitidos}`);
  console.log(
    `Fotos sin detalle vinculable 2025 omitidas: ${fotosOmitidasPorFaltaDetalle}`,
  );

  if (fallidos > 0) {
    throw new Error(
      `La importación terminó con ${fallidos} periodos fallidos. Corrige el error y vuelve a ejecutar; los ya creados se omiten por identificador determinista.`,
    );
  }

  console.log('');
  console.log('✅ Todos los periodos de Principal quedaron importados.');
  console.log(
    '✅ Cada periodo importado quedó como resultado oficial de su objetivo.',
  );
}

main()
  .catch((error) => {
    console.error('');
    console.error('❌ IMPORTACIÓN CANCELADA');
    console.error(
      error instanceof Error ? error.message : String(error),
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });