import { createHash, randomInt } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';

import * as XLSX from 'xlsx';

import { cloudinary } from '../src/config/cloudinary';
import { prisma } from '../src/db';
import {
  AlcanceFormulario,
  OrigenEnvioAuditoria,
  RolUsuario,
  TipoArea,
} from '../src/generated/prisma/enums';

const RUTA_EXCEL_DEFAULT =
  String.raw`C:\Users\MBCPROEW10028\Downloads\Respuestas_Tally.xlsx`;

const FORMULARIO_SLUG = 'evaluacion-5s-operativa';
const FORMULARIO_NOMBRE = "EVALUACION 5'S OPERATIVA";
const NUMERO_VERSION = 1;
const TOTAL_PREGUNTAS = 34;

type Celda = string | number | boolean | Date | null | undefined;

type FechaSimple = {
  anio: number;
  mes: number;
  dia: number;
};

type AreaConfig = {
  codigo: string;
  nombre: string;
  activaActual: boolean;
};

type RespuestaHistorica = {
  numero: number;
  cumple: boolean;
  hallazgo: string | null;
  evidencias: string[];
};

type FilaHistorica = {
  filaExcel: number;
  identificadorCliente: string;
  area: AreaConfig;
  areaOriginal: string;
  auditor: string;
  fechaPeriodo: FechaSimple;
  submittedAt: Date;
  corte: 1 | 2;
  puntaje: number;
  respuestasEsperadas: number;
  respuestasImportadas: number;
  preguntasFaltantes: number[];
  resumenSolamente: boolean;
  parcial: boolean;
  respuestas: RespuestaHistorica[];
};

type FotoSubida = {
  identificadorCliente: string;
  preguntaNumero: number;
  publicIdCloudinary: string;
  assetIdCloudinary: string | null;
  formato: string | null;
  bytes: number | null;
  ancho: number | null;
  alto: number | null;
  subidaEn: Date;
};

type SeccionDefinicion = {
  orden: number;
  nombre: string;
  desde: number;
  hasta: number;
};

const SECCIONES: SeccionDefinicion[] = [
  {
    orden: 1,
    nombre: "1'S SEIRI",
    desde: 1,
    hasta: 4,
  },
  {
    orden: 2,
    nombre: "2'S SEITON",
    desde: 5,
    hasta: 14,
  },
  {
    orden: 3,
    nombre: "3'S SEISO",
    desde: 15,
    hasta: 19,
  },
  {
    orden: 4,
    nombre: "4'S SEIKETSU",
    desde: 20,
    hasta: 22,
  },
  {
    orden: 5,
    nombre: "5'S SHITSUKE",
    desde: 23,
    hasta: 24,
  },
  {
    orden: 6,
    nombre: "6'S SECURITY - APPEARANCE",
    desde: 25,
    hasta: 31,
  },
  {
    orden: 7,
    nombre: 'CULTURA',
    desde: 32,
    hasta: 34,
  },
];

const AREAS: AreaConfig[] = [
  {
    codigo: 'OP-ACABADO',
    nombre: 'ACABADO',
    activaActual: true,
  },
  {
    codigo: 'OP-ADORNO',
    nombre: 'ADORNO',
    activaActual: true,
  },
  {
    codigo: 'OP-ALM-MP',
    nombre: 'ALMACEN DE MATERIA PRIMA',
    activaActual: true,
  },
  {
    codigo: 'OP-ALM-PIELES',
    nombre: 'ALMACEN DE PIELES',
    activaActual: true,
  },
  {
    codigo: 'OP-ALM-PT-DEV',
    nombre: 'ALMACEN DE PT - DEVOLUCIONES',
    activaActual: true,
  },
  {
    codigo: 'OP-AVIO',
    nombre: 'AVIO',
    activaActual: true,
  },
  {
    codigo: 'OP-BILLETERAS',
    nombre: 'BILLETERAS',
    activaActual: true,
  },
  {
    codigo: 'OP-BOLSAS',
    nombre: 'BOLSAS',
    activaActual: true,
  },
  {
    codigo: 'OP-BORDADO',
    nombre: 'BORDADO',
    activaActual: true,
  },
  {
    codigo: 'OP-CAL-MESAS',
    nombre: 'CALIDAD MESAS DE TRABAJO EN PRODUCCION',
    activaActual: true,
  },
  {
    codigo: 'OP-CEL-DES',
    nombre: 'CELULA DESARROLLO',
    activaActual: true,
  },
  {
    codigo: 'OP-CHAMARRAS',
    nombre: 'CHAMARRAS',
    activaActual: true,
  },
  {
    codigo: 'OP-CINTOS',
    nombre: 'CINTOS',
    activaActual: true,
  },
  {
    codigo: 'OP-CORTE',
    nombre: 'CORTE',
    activaActual: true,
  },
  {
    codigo: 'OP-LASER',
    nombre: 'LASER',
    activaActual: true,
  },
  {
    codigo: 'OP-MANT',
    nombre: 'MANTENIMIENTO',
    activaActual: true,
  },
  {
    codigo: 'OP-MAQ-BETA7',
    nombre: 'MAQUILAS BETA 7',
    activaActual: true,
  },
  {
    codigo: 'OP-MONTADO',
    nombre: 'MONTADO',
    activaActual: true,
  },
  {
    codigo: 'OP-PESPUNTE',
    nombre: 'PESPUNTE',
    activaActual: true,
  },
  {
    codigo: 'OP-PREL-KAPPA',
    nombre: 'PRELIMINARES KAPPA',
    activaActual: false,
  },
  {
    codigo: 'OP-PREL-SIGMA',
    nombre: 'PRELIMINARES SIGMA',
    activaActual: true,
  },
];

const argumentos = process.argv.slice(2);

const rutaArchivo =
  argumentos.find((argumento) => !argumento.startsWith('--')) ??
  RUTA_EXCEL_DEFAULT;

const APPLY = argumentos.includes('--apply');
const SKIP_PHOTOS = argumentos.includes('--skip-photos');
const ALLOW_MISSING_PHOTOS =
  argumentos.includes('--allow-missing-photos');

const normalizarEspacios = (valor: unknown) =>
  String(valor ?? '')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const normalizarClave = (valor: unknown) =>
  normalizarEspacios(valor)
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const normalizarTexto = (valor: unknown): string | null => {
  const texto = String(valor ?? '')
    .replace(/\u00a0/g, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/\r\n/g, '\n')
    .trim();

  return texto || null;
};

const limpiarTextoPregunta = (valor: string) => {
  let texto = valor
    .replace(/\u00a0/g, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/\r\n/g, '\n')
    .trim();

  texto = texto.replace(/^\s*\d+\.\s*/, '');

  texto = texto
    .replace(/\s*¿Cumple\?\s*$/i, '')
    .replace(/\s*¿Cuample\?\s*$/i, '')
    .trim();

  return texto;
};

const normalizarComparacionPregunta = (valor: string) =>
  limpiarTextoPregunta(valor)
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();

const areasPorClave = new Map(
  AREAS.map((area) => [normalizarClave(area.nombre), area]),
);

const resolverAreaConfig = (nombreOriginal: string) => {
  const clave = normalizarClave(nombreOriginal);
  const area = areasPorClave.get(clave);

  if (!area) {
    throw new Error(
      `Área operativa no reconocida: "${nombreOriginal}" (${clave})`,
    );
  }

  return area;
};

const uuidDeterminista = (entrada: string) => {
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
};

const claveSeccion = (orden: number) =>
  uuidDeterminista(
    `${FORMULARIO_SLUG}:v1:seccion:${orden}`,
  );

const clavePregunta = (numero: number) =>
  uuidDeterminista(
    `${FORMULARIO_SLUG}:v1:pregunta:${numero}`,
  );

const generarCodigoVerificacion = () => {
  const alfabeto = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

  const generar = (longitud: number) =>
    Array.from(
      { length: longitud },
      () => alfabeto[randomInt(0, alfabeto.length)],
    ).join('');

  return `${generar(4)}-${generar(4)}`;
};

const parseFechaSimple = (
  valor: Celda,
  nombreCampo: string,
): FechaSimple => {
  if (valor instanceof Date && !Number.isNaN(valor.getTime())) {
    return {
      anio: valor.getFullYear(),
      mes: valor.getMonth() + 1,
      dia: valor.getDate(),
    };
  }

  if (typeof valor === 'number') {
    const partes = XLSX.SSF.parse_date_code(valor);

    if (!partes) {
      throw new Error(
        `Fecha Excel inválida en ${nombreCampo}: ${valor}`,
      );
    }

    return {
      anio: partes.y,
      mes: partes.m,
      dia: partes.d,
    };
  }

  const texto = normalizarEspacios(valor);

  const ddmmyyyy = texto.match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/,
  );

  if (ddmmyyyy) {
    return {
      dia: Number(ddmmyyyy[1]),
      mes: Number(ddmmyyyy[2]),
      anio: Number(ddmmyyyy[3]),
    };
  }

  const fecha = new Date(texto);

  if (Number.isNaN(fecha.getTime())) {
    throw new Error(
      `No se pudo interpretar ${nombreCampo}: "${texto}"`,
    );
  }

  return {
    anio: fecha.getFullYear(),
    mes: fecha.getMonth() + 1,
    dia: fecha.getDate(),
  };
};

const parseFechaHora = (
  valor: Celda,
  nombreCampo: string,
): Date => {
  if (valor instanceof Date && !Number.isNaN(valor.getTime())) {
    return new Date(valor);
  }

  if (typeof valor === 'number') {
    const partes = XLSX.SSF.parse_date_code(valor);

    if (!partes) {
      throw new Error(
        `Fecha Excel inválida en ${nombreCampo}: ${valor}`,
      );
    }

    return new Date(
      partes.y,
      partes.m - 1,
      partes.d,
      partes.H ?? 0,
      partes.M ?? 0,
      Math.floor(partes.S ?? 0),
    );
  }

  const texto = normalizarEspacios(valor);
  const fecha = new Date(texto);

  if (Number.isNaN(fecha.getTime())) {
    throw new Error(
      `No se pudo interpretar ${nombreCampo}: "${texto}"`,
    );
  }

  return fecha;
};

const parsePuntaje = (valor: Celda) => {
  if (typeof valor === 'number' && Number.isFinite(valor)) {
    return valor;
  }

  const numero = Number(
    normalizarEspacios(valor).replace(',', '.'),
  );

  if (!Number.isFinite(numero)) {
    throw new Error(
      `Puntaje inválido: "${String(valor)}"`,
    );
  }

  return numero;
};

const parseCumple = (valor: Celda): boolean | null => {
  const texto = normalizarClave(valor);

  if (!texto) {
    return null;
  }

  if (texto === 'SI') {
    return true;
  }

  if (texto === 'NO') {
    return false;
  }

  throw new Error(
    `Respuesta distinta de SÍ/NO: "${String(valor)}"`,
  );
};

const extraerUrls = (valor: Celda): string[] => {
  let texto = String(valor ?? '').trim();

  if (!texto) {
    return [];
  }

  texto = texto.replace(/\\([_:/])/g, '$1');

  return texto
    .split(/,\s*(?=https?:\/\/)/i)
    .map((url) => url.trim())
    .filter((url) => /^https?:\/\//i.test(url));
};

const obtenerUltimoDiaMes = (anio: number, mes: number) =>
  mes === 2 ? 28 : new Date(anio, mes, 0).getDate();
const calcularCorte = (
  fecha: FechaSimple,
): 1 | 2 => (fecha.dia <= 15 ? 1 : 2);

const obtenerLimitesPeriodo = (
  anio: number,
  mes: number,
  corte: 1 | 2,
) => {
  const ultimoDia = obtenerUltimoDiaMes(anio, mes);

  if (corte === 1) {
    return {
      iniciaEn: new Date(
        anio,
        mes - 1,
        1,
        0,
        0,
        0,
        0,
      ),
      terminaEn: new Date(
        anio,
        mes - 1,
        15,
        23,
        59,
        59,
        999,
      ),
    };
  }

  return {
    iniciaEn: new Date(
      anio,
      mes - 1,
      16,
      0,
      0,
      0,
      0,
    ),
    terminaEn: new Date(
      anio,
      mes - 1,
      ultimoDia,
      23,
      59,
      59,
      999,
    ),
  };
};

const crearIdentidadFila = (
  area: AreaConfig,
  auditor: string,
  fechaPeriodo: FechaSimple,
  submittedAt: Date,
  puntaje: number,
  respuestas: RespuestaHistorica[],
) => {
  const contenido = JSON.stringify({
    fuente: 'TALLY_OPERATIVO',
    area: area.codigo,
    auditor,
    fechaPeriodo,
    submittedAt: submittedAt.toISOString(),
    puntaje,
    respuestas,
  });

  return uuidDeterminista(contenido);
};

const leerArchivo = (ruta: string) => {
  if (!existsSync(ruta)) {
    throw new Error(
      `No existe el archivo: ${ruta}`,
    );
  }

  const workbook = XLSX.read(readFileSync(ruta), {
    type: 'buffer',
    cellDates: true,
  });

  const nombreHoja = workbook.SheetNames[0];

  if (!nombreHoja) {
    throw new Error(
      'El Excel no contiene hojas.',
    );
  }

  const hoja = workbook.Sheets[nombreHoja];

  const matriz = XLSX.utils.sheet_to_json(
    hoja,
    {
      header: 1,
      raw: true,
      defval: null,
    },
  ) as Celda[][];

  if (matriz.length < 2) {
    throw new Error(
      'El Excel no contiene registros.',
    );
  }

  return {
    nombreHoja,
    matriz,
  };
};

const analizarExcel = (ruta: string) => {
  const { nombreHoja, matriz } =
    leerArchivo(ruta);

  const headers = matriz[0].map(
    (header) => String(header ?? '').trim(),
  );

  const indiceHeader = new Map<string, number>();

  headers.forEach((header, index) => {
    indiceHeader.set(
      normalizarClave(header),
      index,
    );
  });

  const buscarIndice = (nombre: string) =>
    indiceHeader.get(normalizarClave(nombre));

  const indiceSubmitted =
    buscarIndice('Submitted at');

  const indiceArea =
    buscarIndice('Área');

  const indiceAuditor =
    buscarIndice('Auditor(es)');

  const indiceFecha =
    buscarIndice('Fecha');

  const indicePuntaje =
    buscarIndice('Puntaje 5S');

  if (
    indiceSubmitted === undefined ||
    indiceArea === undefined ||
    indiceAuditor === undefined ||
    indiceFecha === undefined ||
    indicePuntaje === undefined
  ) {
    throw new Error(
      'Faltan columnas principales del XLSX.',
    );
  }

  const respuestasColumnas =
    new Map<number, number>();

  const hallazgosColumnas =
    new Map<number, number>();

  const evidenciasColumnas =
    new Map<number, number>();

  const preguntasTexto =
    new Map<number, string>();

  headers.forEach((header, index) => {
    const pregunta = header.match(
      /^\s*(\d+)\./,
    );

    if (pregunta) {
      const numero = Number(
        pregunta[1],
      );

      if (
        numero >= 1 &&
        numero <= TOTAL_PREGUNTAS
      ) {
        respuestasColumnas.set(
          numero,
          index,
        );

        preguntasTexto.set(
          numero,
          limpiarTextoPregunta(header),
        );
      }
    }

    const hallazgo = header.match(
      /^Hallazgo Detectado\s+(\d+)$/i,
    );

    if (hallazgo) {
      hallazgosColumnas.set(
        Number(hallazgo[1]),
        index,
      );
    }

    const evidencia = header.match(
      /^Evidencia\s+(\d+)$/i,
    );

    if (evidencia) {
      evidenciasColumnas.set(
        Number(evidencia[1]),
        index,
      );
    }
  });

  if (
    respuestasColumnas.size !==
    TOTAL_PREGUNTAS
  ) {
    throw new Error(
      `Se esperaban ${TOTAL_PREGUNTAS} columnas de respuesta y se encontraron ${respuestasColumnas.size}.`,
    );
  }

  if (
    preguntasTexto.size !==
    TOTAL_PREGUNTAS
  ) {
    throw new Error(
      `No se pudieron recuperar los textos de las ${TOTAL_PREGUNTAS} preguntas.`,
    );
  }

  const filas: FilaHistorica[] = [];
  const errores: string[] = [];
  const hallazgosFaltantes: Array<{
    filaExcel: number;
    pregunta: number;
  }> = [];

  for (
    let i = 1;
    i < matriz.length;
    i += 1
  ) {
    const fila = matriz[i];
    const filaExcel = i + 1;

    const vacia = fila.every(
      (celda) =>
        celda === null ||
        normalizarEspacios(celda) === '',
    );

    if (vacia) {
      continue;
    }

    try {
      const areaOriginal =
        normalizarEspacios(
          fila[indiceArea],
        );

      const auditor =
        normalizarEspacios(
          fila[indiceAuditor],
        );

      if (!areaOriginal) {
        throw new Error(
          'Área vacía.',
        );
      }

      if (!auditor) {
        throw new Error(
          'Auditor(es) vacío.',
        );
      }

      const area =
        resolverAreaConfig(
          areaOriginal,
        );

      const fechaPeriodo =
        parseFechaSimple(
          fila[indiceFecha],
          'Fecha',
        );

      const submittedAt =
        parseFechaHora(
          fila[indiceSubmitted],
          'Submitted at',
        );

      const puntaje =
        parsePuntaje(
          fila[indicePuntaje],
        );

      if (
        puntaje < 0 ||
        puntaje > TOTAL_PREGUNTAS
      ) {
        throw new Error(
          `Puntaje fuera de rango: ${puntaje}/${TOTAL_PREGUNTAS}`,
        );
      }

      const corte =
        calcularCorte(
          fechaPeriodo,
        );

      const respuestas:
        RespuestaHistorica[] = [];

      const preguntasFaltantes:
        number[] = [];

      for (
        let numero = 1;
        numero <= TOTAL_PREGUNTAS;
        numero += 1
      ) {
        const indiceRespuesta =
          respuestasColumnas.get(
            numero,
          );

        if (
          indiceRespuesta === undefined
        ) {
          throw new Error(
            `No existe columna de pregunta ${numero}.`,
          );
        }

        const cumple =
          parseCumple(
            fila[indiceRespuesta],
          );

        if (cumple === null) {
          preguntasFaltantes.push(
            numero,
          );
          continue;
        }

        const indiceHallazgo =
          hallazgosColumnas.get(
            numero,
          );

        const indiceEvidencia =
          evidenciasColumnas.get(
            numero,
          );

        const hallazgo =
          indiceHallazgo === undefined
            ? null
            : normalizarTexto(
                fila[indiceHallazgo],
              );

        const evidencias =
          indiceEvidencia === undefined
            ? []
            : extraerUrls(
                fila[indiceEvidencia],
              );

        if (!cumple && !hallazgo) {
          hallazgosFaltantes.push({
            filaExcel,
            pregunta: numero,
          });
        }

        respuestas.push({
          numero,
          cumple,
          hallazgo,
          evidencias,
        });
      }

      const respuestasImportadas =
        respuestas.length;

      const resumenSolamente =
        respuestasImportadas === 0;

      const parcial =
        respuestasImportadas > 0 &&
        respuestasImportadas <
          TOTAL_PREGUNTAS;

      if (
        !resumenSolamente &&
        !parcial &&
        respuestasImportadas !==
          TOTAL_PREGUNTAS
      ) {
        throw new Error(
          `Cantidad de respuestas inesperada: ${respuestasImportadas}`,
        );
      }

      const puntosCalculados =
        respuestas.filter(
          (respuesta) =>
            respuesta.cumple,
        ).length;

      if (
        !resumenSolamente &&
        puntosCalculados !==
          puntaje
      ) {
        throw new Error(
          `Puntaje Excel=${puntaje}; cantidad de SÍ=${puntosCalculados}.`,
        );
      }

      const identificadorCliente =
        crearIdentidadFila(
          area,
          auditor,
          fechaPeriodo,
          submittedAt,
          puntaje,
          respuestas,
        );

      filas.push({
        filaExcel,
        identificadorCliente,
        area,
        areaOriginal,
        auditor,
        fechaPeriodo,
        submittedAt,
        corte,
        puntaje,
        respuestasEsperadas:
          TOTAL_PREGUNTAS,
        respuestasImportadas,
        preguntasFaltantes,
        resumenSolamente,
        parcial,
        respuestas,
      });
    } catch (error) {
      errores.push(
        `Fila ${filaExcel}: ${
          error instanceof Error
            ? error.message
            : String(error)
        }`,
      );
    }
  }

  const grupos =
    new Map<
      string,
      FilaHistorica[]
    >();

  for (const fila of filas) {
    const clave = [
      fila.fechaPeriodo.anio,
      String(
        fila.fechaPeriodo.mes,
      ).padStart(2, '0'),
      fila.corte,
      fila.area.codigo,
    ].join(':');

    const grupo =
      grupos.get(clave) ?? [];

    grupo.push(fila);
    grupos.set(
      clave,
      grupo,
    );
  }

  const duplicadosPeriodo =
    [...grupos.entries()]
      .filter(
        ([, grupo]) =>
          grupo.length > 1,
      )
      .map(
        ([clave, grupo]) => ({
          clave,
          filas: grupo.map(
            (fila) => ({
              filaExcel:
                fila.filaExcel,
              auditor:
                fila.auditor,
              puntaje:
                fila.puntaje,
              submittedAt:
                fila.submittedAt.toISOString(),
            }),
          ),
        }),
      );

  const totalFotos =
    filas.reduce(
      (total, fila) =>
        total +
        fila.respuestas.reduce(
          (
            subtotal,
            respuesta,
          ) =>
            subtotal +
            respuesta
              .evidencias.length,
          0,
        ),
      0,
    );

  const resumenes =
    filas.filter(
      (fila) =>
        fila.resumenSolamente,
    ).length;

  const completas =
    filas.filter(
      (fila) =>
        fila.respuestasImportadas ===
        TOTAL_PREGUNTAS,
    ).length;

  const parciales =
    filas.filter(
      (fila) => fila.parcial,
    );

  return {
    nombreHoja,
    filas,
    preguntasTexto,
    errores,
    hallazgosFaltantes,
    duplicadosPeriodo,
    totalFotos,
    resumenes,
    completas,
    parciales,
  };
};

const obtenerCreador =
  async () => {
    const superAdmin =
      await prisma.usuario.findFirst({
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

    const administrador =
      await prisma.usuario.findFirst({
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
  };

const consultarFormularioOperativo =
  () =>
    prisma.formulario.findUnique({
      where: {
        slug: FORMULARIO_SLUG,
      },
      include: {
        versiones: {
          where: {
            numeroVersion:
              NUMERO_VERSION,
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

const validarFormularioExistente =
  (
    formulario: NonNullable<
      Awaited<
        ReturnType<
          typeof consultarFormularioOperativo
        >
      >
    >,
    preguntasEsperadas:
      Map<number, string>,
  ) => {
    if (
      formulario.alcance !==
      AlcanceFormulario.OPERATIVO
    ) {
      throw new Error(
        `El formulario ${FORMULARIO_SLUG} existe pero no es OPERATIVO.`,
      );
    }

    const version =
      formulario.versiones[0];

    if (!version) {
      throw new Error(
        `Existe ${FORMULARIO_SLUG} pero no tiene V${NUMERO_VERSION}.`,
      );
    }

    if (
      version.secciones.length !==
      SECCIONES.length
    ) {
      throw new Error(
        `V1 operativa tiene ${version.secciones.length} secciones; se esperaban ${SECCIONES.length}.`,
      );
    }

    const preguntas =
      version.secciones.flatMap(
        (seccion) =>
          seccion.preguntas,
      );

    if (
      preguntas.length !==
      TOTAL_PREGUNTAS
    ) {
      throw new Error(
        `V1 operativa tiene ${preguntas.length} preguntas; se esperaban ${TOTAL_PREGUNTAS}.`,
      );
    }

    const diferencias:
      string[] = [];

    for (
      let numero = 1;
      numero <= TOTAL_PREGUNTAS;
      numero += 1
    ) {
      const esperada =
        preguntasEsperadas.get(
          numero,
        );

      const existente =
        preguntas[
          numero - 1
        ];

      if (
        !esperada ||
        !existente
      ) {
        diferencias.push(
          `P${numero}: faltante`,
        );
        continue;
      }

      if (
        normalizarComparacionPregunta(
          existente.texto,
        ) !==
        normalizarComparacionPregunta(
          esperada,
        )
      ) {
        diferencias.push(
          `P${numero}: texto distinto`,
        );
      }
    }

    if (
      diferencias.length > 0
    ) {
      throw new Error(
        [
          'La V1 operativa existente no coincide con el XLSX:',
          ...diferencias,
        ].join('\n'),
      );
    }

    return {
      formulario,
      version,
      preguntas,
    };
  };

const crearFormularioOperativo =
  async (
    creadoPorId: number,
    preguntasTexto:
      Map<number, string>,
  ) => {
    await prisma.$transaction(
      async (tx) => {
        const formulario =
          await tx.formulario.create({
            data: {
              nombre:
                FORMULARIO_NOMBRE,
              slug:
                FORMULARIO_SLUG,
              descripcion: null,
              alcance:
                AlcanceFormulario.OPERATIVO,
              activo: true,
              creadoPorId,
            },
          });

        const version =
          await tx.versionFormulario.create({
            data: {
              formularioId:
                formulario.id,
              numeroVersion:
                NUMERO_VERSION,
              activa: true,
              creadoPorId,
            },
          });

        for (
          const seccionDef
          of SECCIONES
        ) {
          const seccion =
            await tx.seccionFormulario.create({
              data: {
                versionFormularioId:
                  version.id,
                claveEstable:
                  claveSeccion(
                    seccionDef.orden,
                  ),
                nombre:
                  seccionDef.nombre,
                objetivo: null,
                orden:
                  seccionDef.orden,
              },
            });

          for (
            let numero =
              seccionDef.desde;
            numero <=
            seccionDef.hasta;
            numero += 1
          ) {
            const texto =
              preguntasTexto.get(
                numero,
              );

            if (!texto) {
              throw new Error(
                `No existe texto para P${numero}.`,
              );
            }

            await tx.preguntaFormulario.create({
              data: {
                seccionFormularioId:
                  seccion.id,
                claveEstable:
                  clavePregunta(
                    numero,
                  ),
                texto,
                orden: numero,
              },
            });
          }
        }
      },
    );

    const creado =
      await consultarFormularioOperativo();

    if (!creado) {
      throw new Error(
        'No se pudo recuperar el formulario operativo después de crearlo.',
      );
    }

    return validarFormularioExistente(
      creado,
      preguntasTexto,
    );
  };

const prepararFormularioOperativo =
  async (
    creadoPorId: number,
    preguntasTexto:
      Map<number, string>,
    aplicar: boolean,
  ) => {
    const existente =
      await consultarFormularioOperativo();

    if (existente) {
      return {
        estado:
          'EXISTENTE' as const,
        datos:
          validarFormularioExistente(
            existente,
            preguntasTexto,
          ),
      };
    }

    if (!aplicar) {
      return {
        estado:
          'SE_CREARA' as const,
        datos: null,
      };
    }

    return {
      estado:
        'CREADO' as const,
      datos:
        await crearFormularioOperativo(
          creadoPorId,
          preguntasTexto,
        ),
    };
  };

const verificarCloudinary =
  (totalFotos: number) => {
    if (
      SKIP_PHOTOS ||
      totalFotos === 0
    ) {
      return;
    }

    const enabled =
      process.env
        .CLOUDINARY_ENABLED ===
      'true';

    const cloudName =
      Boolean(
        process.env
          .CLOUDINARY_CLOUD_NAME,
      );

    const apiKey =
      Boolean(
        process.env
          .CLOUDINARY_API_KEY,
      );

    const apiSecret =
      Boolean(
        process.env
          .CLOUDINARY_API_SECRET,
      );

    if (
      !enabled ||
      !cloudName ||
      !apiKey ||
      !apiSecret
    ) {
      throw new Error(
        [
          `El Excel contiene ${totalFotos} evidencias.`,
          'Cloudinary no está completamente configurado.',
          `CLOUDINARY_ENABLED=${enabled}`,
          `CLOUDINARY_CLOUD_NAME=${cloudName}`,
          `CLOUDINARY_API_KEY=${apiKey}`,
          `CLOUDINARY_API_SECRET=${apiSecret}`,
          'No se insertó ninguna fila.',
        ].join('\n'),
      );
    }
  };

const preflightAreas =
  async () => {
    const existentes =
      await prisma.area.findMany({
        select: {
          id: true,
          codigo: true,
          nombre: true,
          tipo: true,
          activo: true,
        },
      });

    const errores:
      string[] = [];

    const nuevas:
      AreaConfig[] = [];

    const reutilizadas:
      Array<{
        config: AreaConfig;
        id: number;
      }> = [];

    const coexistentesAdministrativas:
      AreaConfig[] = [];

    for (
      const config of AREAS
    ) {
      const mismoNombre =
        existentes.filter(
          (area) =>
            normalizarClave(
              area.nombre,
            ) ===
            normalizarClave(
              config.nombre,
            ),
        );

      const operativas =
        mismoNombre.filter(
          (area) =>
            area.tipo ===
            TipoArea.OPERATIVA,
        );

      const administrativas =
        mismoNombre.filter(
          (area) =>
            area.tipo ===
            TipoArea.ADMINISTRATIVA,
        );

      if (
        operativas.length > 1
      ) {
        errores.push(
          `Hay ${operativas.length} áreas OPERATIVAS con nombre "${config.nombre}".`,
        );
        continue;
      }

      if (
        operativas.length === 1
      ) {
        reutilizadas.push({
          config,
          id: operativas[0].id,
        });
        continue;
      }

      const codigoOcupado =
        existentes.find(
          (area) =>
            area.codigo ===
            config.codigo,
        );

      if (codigoOcupado) {
        errores.push(
          `El código ${config.codigo} ya pertenece a "${codigoOcupado.nombre}".`,
        );
        continue;
      }

      if (
        administrativas.length > 0
      ) {
        coexistentesAdministrativas.push(
          config,
        );
      }

      nuevas.push(config);
    }

    if (
      errores.length > 0
    ) {
      throw new Error(
        errores.join('\n'),
      );
    }

    return {
      nuevas,
      reutilizadas,
      coexistentesAdministrativas,
    };
  };

const obtenerOCrearAreaOperativa =
  async (
    config: AreaConfig,
  ) => {
    const areas =
      await prisma.area.findMany();

    const operativas =
      areas.filter(
        (area) =>
          area.tipo ===
            TipoArea.OPERATIVA &&
          normalizarClave(
            area.nombre,
          ) ===
            normalizarClave(
              config.nombre,
            ),
      );

    if (
      operativas.length > 1
    ) {
      throw new Error(
        `Hay múltiples áreas operativas para "${config.nombre}".`,
      );
    }

    if (
      operativas.length === 1
    ) {
      const existente =
        operativas[0];

      if (
        existente.activo !==
        config.activaActual
      ) {
        return prisma.area.update({
          where: {
            id: existente.id,
          },
          data: {
            activo:
              config.activaActual,
          },
        });
      }

      return existente;
    }

    const codigoOcupado =
      areas.find(
        (area) =>
          area.codigo ===
          config.codigo,
      );

    if (codigoOcupado) {
      throw new Error(
        `Código ${config.codigo} ocupado por "${codigoOcupado.nombre}".`,
      );
    }

    for (
      let intento = 0;
      intento < 30;
      intento += 1
    ) {
      const codigoVerificacion =
        generarCodigoVerificacion();

      const ocupado =
        await prisma.area.findUnique({
          where: {
            codigoVerificacion,
          },
          select: {
            id: true,
          },
        });

      if (ocupado) {
        continue;
      }

      return prisma.area.create({
        data: {
          codigo:
            config.codigo,
          nombre:
            config.nombre,
          tipo:
            TipoArea.OPERATIVA,
          activo:
            config.activaActual,
          codigoVerificacion,
        },
      });
    }

    throw new Error(
      `No fue posible generar código de verificación para ${config.nombre}.`,
    );
  };

const construirContextoPeriodo =
  (
    fila: FilaHistorica,
    versionFormularioId: number,
  ) => {
    const {
      anio,
      mes,
    } = fila.fechaPeriodo;

    const periodo =
      fila.corte;

    const limites =
      obtenerLimitesPeriodo(
        anio,
        mes,
        periodo,
      );

    return {
      anio,
      mes,
      periodo,
      versionFormularioId,
      iniciaEn:
        limites.iniciaEn,
      terminaEn:
        limites.terminaEn,
    };
  };

const asegurarObjetivo =
  async (
    fila: FilaHistorica,
    areaId: number,
    contexto: ReturnType<typeof construirContextoPeriodo>,
  ) => {
    const existente =
      await prisma.objetivoAuditoria.findUnique({
        where: {
          areaId_anio_mes_periodo: {
            areaId,
            anio: contexto.anio,
            mes: contexto.mes,
            periodo: contexto.periodo,
          },
        },
      });

    if (existente) {
      const fechasCoinciden =
        Math.abs(
          existente.iniciaEn.getTime() -
            contexto.iniciaEn.getTime(),
        ) <= 1000
        && Math.abs(
          existente.terminaEn.getTime() -
            contexto.terminaEn.getTime(),
        ) <= 1000;

      if (
        existente.versionFormularioId !==
          contexto.versionFormularioId
        || !fechasCoinciden
      ) {
        throw new Error(
          `El objetivo existente #${existente.id} ya utiliza otra versión o fechas para ${contexto.anio}-${contexto.mes} P${contexto.periodo}.`,
        );
      }

      return existente;
    }

    return prisma.objetivoAuditoria.create({
      data: {
        areaId,
        anio:
          contexto.anio,
        mes:
          contexto.mes,
        periodo:
          contexto.periodo,
        versionFormularioId:
          contexto.versionFormularioId,
        iniciaEn:
          contexto.iniciaEn,
        terminaEn:
          contexto.terminaEn,
        codigoAreaSnapshot:
          fila.area.codigo,
        nombreAreaSnapshot:
          fila.area.nombre,
        tipoAreaSnapshot:
          TipoArea.OPERATIVA,
      },
    });
  };
const obtenerMensajeError = (error: unknown): string => {
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
};

const subirImagenTally = async (
  url: string,
  options: {
    folder: string;
    publicId: string;
  },
) => {
  /*
   * Usamos exactamente el mismo mecanismo que ya funcionó
   * en el importador administrativo:
   *
   * Tally URL -> cloudinary.uploader.upload(...)
   *
   * No usamos upload_stream ni upload presets.
   */
  try {
    const resultado = await cloudinary.uploader.upload(
      url,
      {
        resource_type: 'image',
        folder: options.folder,
        public_id: options.publicId,
        overwrite: true,
        unique_filename: false,
        use_filename: false,
      },
    );

    return {
      omitido: false as const,
      resultado,
    };
  } catch (errorCloudinary) {
    /*
     * Si Cloudinary rechaza el archivo como imagen,
     * consultamos Tally únicamente para distinguir un
     * video histórico de una imagen realmente dañada.
     */
    const mensajeCloudinary =
      obtenerMensajeError(errorCloudinary);

    let response: Response;

    try {
      response = await fetch(url, {
        method: 'GET',
        redirect: 'follow',
        headers: {
          Accept: '*/*',
          'User-Agent':
            'Encuestas5S-HistoricalImporter/1.0',
        },
      });
    } catch (errorFetch) {
      throw new Error(
        [
          `Cloudinary rechazó la evidencia: ${mensajeCloudinary}`,
          `Además no se pudo consultar Tally: ${obtenerMensajeError(
            errorFetch,
          )}`,
        ].join(' | '),
        { cause: errorFetch }
      );
    }

    if (!response.ok) {
      throw new Error(
        [
          `Cloudinary rechazó la evidencia: ${mensajeCloudinary}`,
          `Tally respondió HTTP ${response.status} ${response.statusText}`,
        ].join(' | '),
        { cause: errorCloudinary }
      );
    }

    const contentType = (
      response.headers.get('content-type') ?? ''
    )
      .split(';')[0]
      .trim()
      .toLowerCase();

    /*
     * Decisión de negocio:
     * los videos históricos se omiten, pero NO se
     * descarta la auditoría ni las demás imágenes.
     */
    if (contentType.startsWith('video/')) {
      try {
        await response.body?.cancel();
      } catch {
        // No es relevante si el stream ya fue cerrado.
      }

      return {
        omitido: true as const,
        motivo: `video histórico (${contentType})`,
      };
    }

    try {
      await response.body?.cancel();
    } catch {
      // No es relevante si el stream ya fue cerrado.
    }

    /*
     * Si Tally confirma que es una imagen (o devuelve
     * otro tipo), NO la omitimos silenciosamente.
     * Conservamos el error real para detectar una
     * evidencia dañada o no soportada.
     */
    throw new Error(
      [
        `Cloudinary no pudo importar la evidencia como imagen: ${mensajeCloudinary}`,
        `content-type Tally=${contentType || 'desconocido'}`,
      ].join(' | '),
      { cause: errorCloudinary }
    );
  }
};

const subirFotosFila =
  async (
    fila: FilaHistorica,
  ): Promise<FotoSubida[]> => {
    if (SKIP_PHOTOS) {
      return [];
    }

    const planes =
      fila.respuestas.flatMap(
        (respuesta) =>
          respuesta.evidencias.map(
            (url, indice) => ({
              preguntaNumero:
                respuesta.numero,
              indice,
              url,
            }),
          ),
      );

    if (planes.length === 0) {
      return [];
    }

    const fotos: FotoSubida[] = [];

    for (const plan of planes) {
      const identificadorCliente =
        uuidDeterminista(
          [
            'TALLY_FOTO_OPERATIVO',
            fila.identificadorCliente,
            plan.preguntaNumero,
            plan.indice,
            plan.url,
          ].join(':'),
        );

      const publicId =
        `tally-${identificadorCliente.replace(
          /-/g,
          '',
        )}`;

      const folder = [
        'encuestas-5s',
        'historico-tally',
        'operativa',
        String(
          fila.fechaPeriodo.anio,
        ),
        String(
          fila.fechaPeriodo.mes,
        ).padStart(2, '0'),
        `periodo-${fila.corte}`,
        fila.area.codigo.toLowerCase(),
        `pregunta-${plan.preguntaNumero}`,
      ].join('/');

      try {
        const subida =
          await subirImagenTally(
            plan.url,
            {
              folder,
              publicId,
            },
          );

        /*
         * Decisión de negocio:
         * los videos históricos de Tally se omiten.
         *
         * Importante: se omite únicamente esa evidencia.
         * La auditoría, sus respuestas y las demás imágenes
         * de la misma fila continúan normalmente.
         */
        if (subida.omitido) {
          console.warn(
            `   🎥 Fila ${fila.filaExcel} · P${plan.preguntaNumero} · OMITIDA · ${subida.motivo}`,
          );

          continue;
        }

        const resultado =
          subida.resultado;

        fotos.push({
          identificadorCliente,

          preguntaNumero:
            plan.preguntaNumero,

          publicIdCloudinary:
            resultado.public_id,

          assetIdCloudinary:
            resultado.asset_id ??
            null,

          formato:
            resultado.format ??
            null,

          bytes:
            typeof resultado.bytes ===
            'number'
              ? resultado.bytes
              : null,

          ancho:
            typeof resultado.width ===
            'number'
              ? resultado.width
              : null,

          alto:
            typeof resultado.height ===
            'number'
              ? resultado.height
              : null,

          subidaEn: new Date(),
        });

        console.log(
          `   📷 Fila ${fila.filaExcel} · P${plan.preguntaNumero} · OK`,
        );
      } catch (error) {
        const mensaje =
          obtenerMensajeError(error);

        console.error(
          `   ❌ Foto fila ${fila.filaExcel} · P${plan.preguntaNumero}: ${mensaje}`,
        );

        /*
         * Sólo mostramos datos suficientes para identificar
         * la evidencia. NO logueamos la URL completa porque
         * contiene accessToken/signature de Tally.
         */
        console.error(
          `      Evidencia índice ${plan.indice + 1}`,
        );

        if (!ALLOW_MISSING_PHOTOS) {
          throw new Error(
            `No se pudieron migrar todas las fotos de la fila ${fila.filaExcel}. Último error: ${mensaje}`,
            { cause: error }
          );
        }
      }
    }

    return fotos;
  };

const imprimirDryRun =
  (
    analisis: ReturnType<
      typeof analizarExcel
    >,
    areasBd: Awaited<
      ReturnType<
        typeof preflightAreas
      >
    >,
    estadoFormulario:
      string,
  ) => {
    console.log('');
    console.log(
      '==============================================',
    );
    console.log(
      ' DRY RUN · HISTÓRICO TALLY OPERATIVO',
    );
    console.log(
      '==============================================',
    );

    console.log(
      `Hoja: ${analisis.nombreHoja}`,
    );

    console.log(
      `Auditorías válidas: ${analisis.filas.length}`,
    );

    console.log(
      `Completas 34/34: ${analisis.completas}`,
    );

    console.log(
      `Sólo resumen: ${analisis.resumenes}`,
    );

    console.log(
      `Parciales: ${analisis.parciales.length}`,
    );

    console.log(
      `Evidencias/fotos detectadas: ${analisis.totalFotos}`,
    );

    console.log(
      `Áreas históricas: ${
        new Set(
          analisis.filas.map(
            (fila) =>
              fila.area.codigo,
          ),
        ).size
      }`,
    );

    console.log(
      `Áreas operativas actuales: ${
        AREAS.filter(
          (area) =>
            area.activaActual,
        ).length
      }`,
    );

    console.log(
      'PRELIMINARES KAPPA: INACTIVA actualmente',
    );

    console.log(
      'PRELIMINARES SIGMA: ACTIVA actualmente',
    );

    console.log(
      `Formulario operativo: ${estadoFormulario}`,
    );

    console.log(
      `Áreas nuevas a crear: ${areasBd.nuevas.length}`,
    );

    console.log(
      `Áreas operativas ya existentes: ${areasBd.reutilizadas.length}`,
    );

    console.log(
      `Nombres que también existen como ADMINISTRATIVOS: ${areasBd.coexistentesAdministrativas.length}`,
    );

    if (
      areasBd
        .coexistentesAdministrativas
        .length > 0
    ) {
      console.log(
        '',
      );

      console.log(
        'SE CREARÁ UNA FILA OPERATIVA SEPARADA PARA:',
      );

      for (
        const area
        of areasBd
          .coexistentesAdministrativas
      ) {
        console.log(
          `- ${area.nombre}`,
        );
      }
    }

    if (
      analisis.parciales.length >
      0
    ) {
      console.log('');
      console.log(
        'AUDITORÍAS PARCIALES:',
      );

      for (
        const fila
        of analisis.parciales
      ) {
        console.log(
          `- fila=${fila.filaExcel} área="${fila.area.nombre}" fecha=${fila.fechaPeriodo.anio}-${String(
            fila.fechaPeriodo.mes,
          ).padStart(
            2,
            '0',
          )}-${String(
            fila.fechaPeriodo.dia,
          ).padStart(
            2,
            '0',
          )} respuestas=${fila.respuestasImportadas}/34 faltantes=${fila.preguntasFaltantes.join(
            ',',
          )}`,
        );
      }
    }

    console.log(
      `NO históricos sin hallazgo: ${analisis.hallazgosFaltantes.length}`,
    );

    console.log(
      `Periodos con más de un envío: ${analisis.duplicadosPeriodo.length}`,
    );

    if (
      analisis
        .duplicadosPeriodo
        .length > 0
    ) {
      console.log('');
      console.log(
        'CONFLICTOS DE ENVIO RESULTADO:',
      );

      for (
        const conflicto
        of analisis.duplicadosPeriodo
      ) {
        console.log(
          `- ${conflicto.clave}`,
        );

        for (
          const fila
          of conflicto.filas
        ) {
          console.log(
            `    fila=${fila.filaExcel} auditor="${fila.auditor}" puntaje=${fila.puntaje} submitted=${fila.submittedAt}`,
          );
        }
      }
    }

    if (
      analisis.errores.length >
      0
    ) {
      console.log('');
      console.log(
        'ERRORES:',
      );

      for (
        const error
        of analisis.errores
      ) {
        console.log(
          `- ${error}`,
        );
      }
    }

    console.log('');
  };

const aplicarImportacion =
  async (
    analisis: ReturnType<
      typeof analizarExcel
    >,
  ) => {
    if (
      analisis.errores.length >
      0
    ) {
      throw new Error(
        'Existen errores de análisis. No se aplicará la importación.',
      );
    }

    verificarCloudinary(
      analisis.totalFotos,
    );

    await preflightAreas();

    const creador =
      await obtenerCreador();

    const formularioPreparado =
      await prepararFormularioOperativo(
        creador.id,
        analisis.preguntasTexto,
        true,
      );

    if (
      !formularioPreparado.datos
    ) {
      throw new Error(
        'No fue posible preparar el formulario operativo.',
      );
    }

    const {
      version,
      preguntas,
    } =
      formularioPreparado.datos;

    console.log(
      `Creador técnico: ${creador.nombre} (${creador.rol})`,
    );

    console.log(
      `Formulario operativo: ${FORMULARIO_SLUG} V${version.numeroVersion}`,
    );

    const areasCache =
      new Map<
        string,
        Awaited<
          ReturnType<
            typeof obtenerOCrearAreaOperativa
          >
        >
      >();

    const periodosCache =
      new Map<
        string,
        ReturnType<
          typeof construirContextoPeriodo
        >
      >();
    const objetivosTocados =
      new Set<number>();

    let creados = 0;
    let existentes = 0;
    let fotosCreadas = 0;
    let filasFallidas = 0;

    const filasOrdenadas =
      [...analisis.filas].sort(
        (a, b) =>
          a.submittedAt.getTime() -
          b.submittedAt.getTime(),
      );

    for (
      const fila
      of filasOrdenadas
    ) {
      console.log('');
      console.log(
        `Fila ${fila.filaExcel} · ${fila.area.nombre} · ${fila.fechaPeriodo.anio}-${String(
          fila.fechaPeriodo.mes,
        ).padStart(
          2,
          '0',
        )} P${fila.corte}`,
      );

      const existente =
        await prisma.envioAuditoria.findUnique({
          where: {
            identificadorCliente:
              fila.identificadorCliente,
          },
          select: {
            id: true,
            objetivoAuditoriaId:
              true,
          },
        });

      if (existente) {
        console.log(
          `   ↪ Ya importada. Envío #${existente.id}`,
        );

        existentes += 1;

        objetivosTocados.add(
          existente.objetivoAuditoriaId,
        );

        continue;
      }

      try {
        let area =
          areasCache.get(
            fila.area.codigo,
          );

        if (!area) {
          area =
            await obtenerOCrearAreaOperativa(
              fila.area,
            );

          areasCache.set(
            fila.area.codigo,
            area,
          );
        }

        const clavePeriodo =
          `${fila.fechaPeriodo.anio}-${fila.fechaPeriodo.mes}-${fila.corte}-${version.id}`;

        let contextoPeriodo =
          periodosCache.get(
            clavePeriodo,
          );

        if (!contextoPeriodo) {
          contextoPeriodo =
            construirContextoPeriodo(
              fila,
              version.id,
            );

          periodosCache.set(
            clavePeriodo,
            contextoPeriodo,
          );
        }

        const objetivo =
          await asegurarObjetivo(
            fila,
            area.id,
            contextoPeriodo,
          );

        objetivosTocados.add(
          objetivo.id,
        );
        const fotos =
          await subirFotosFila(
            fila,
          );

        const porcentaje =
          (fila.puntaje /
            TOTAL_PREGUNTAS) *
          100;

        await prisma.$transaction(
          async (tx) => {
            const envio =
              await tx.envioAuditoria.create({
                data: {
                  identificadorCliente:
                    fila.identificadorCliente,

                  objetivoAuditoriaId:
                    objetivo.id,

                  asignacionAuditoriaId:
                    null,

                  enviadoPorUsuarioId:
                    null,

                  enlaceInvitadoId:
                    null,

                  nombreAuditorSnapshot:
                    fila.auditor.slice(
                      0,
                      160,
                    ),

                  origen:
                    OrigenEnvioAuditoria.INVITADO,

                  puntajeObtenido:
                    fila.puntaje.toFixed(
                      4,
                    ),

                  puntajePosible:
                    TOTAL_PREGUNTAS.toFixed(
                      4,
                    ),

                  porcentaje:
                    porcentaje.toFixed(
                      4,
                    ),

                  // Histórico Tally.
                  // El sistema antiguo no tenía
                  // nuestro QR. Se utiliza
                  // Submitted at como fecha real.
                  finalizadoEn:
                    fila.submittedAt,

                  verificadoEn:
                    fila.submittedAt,

                  recibidoEn:
                    fila.submittedAt,
                },
              });

            const respuestaIdPorNumero =
              new Map<
                number,
                number
              >();

            for (
              const respuesta
              of fila.respuestas
            ) {
              const pregunta =
                preguntas[
                  respuesta.numero -
                    1
                ];

              if (!pregunta) {
                throw new Error(
                  `No existe PreguntaFormulario para P${respuesta.numero}.`,
                );
              }

              const respuestaCreada =
                await tx.respuestaAuditoria.create({
                  data: {
                    envioAuditoriaId:
                      envio.id,

                    preguntaFormularioId:
                      pregunta.id,

                    cumple:
                      respuesta.cumple,

                    hallazgo:
                      respuesta.hallazgo,
                  },
                });

              respuestaIdPorNumero.set(
                respuesta.numero,
                respuestaCreada.id,
              );
            }

            for (
              const foto
              of fotos
            ) {
              const respuestaId =
                respuestaIdPorNumero.get(
                  foto.preguntaNumero,
                );

              if (!respuestaId) {
                throw new Error(
                  `La foto de P${foto.preguntaNumero} no tiene respuesta histórica asociada.`,
                );
              }

              await tx.fotoAuditoria.create({
                data: {
                  identificadorCliente:
                    foto.identificadorCliente,

                  respuestaAuditoriaId:
                    respuestaId,

                  publicIdCloudinary:
                    foto.publicIdCloudinary,

                  assetIdCloudinary:
                    foto.assetIdCloudinary,

                  formato:
                    foto.formato,

                  bytes:
                    foto.bytes,

                  ancho:
                    foto.ancho,

                  alto:
                    foto.alto,

                  subidaEn:
                    foto.subidaEn,
                },
              });

              fotosCreadas += 1;
            }

            await tx.registroAuditoria.create({
              data: {
                accion:
                  'IMPORTAR_HISTORICO_TALLY_OPERATIVO',

                tipoEntidad:
                  'EnvioAuditoria',

                idEntidad:
                  envio.id,

                datosNuevos: {
                  fuente:
                    'TALLY_OPERATIVO',

                  filaExcel:
                    fila.filaExcel,

                  areaOriginal:
                    fila.areaOriginal,

                  resumenSolamente:
                    fila.resumenSolamente,

                  parcial:
                    fila.parcial,

                  respuestasEsperadas:
                    TOTAL_PREGUNTAS,

                  respuestasImportadas:
                    fila.respuestasImportadas,

                  preguntasFaltantes:
                    fila.preguntasFaltantes,
                },
              },
            });
          },
        );

        creados += 1;

        console.log(
          `   ✅ Importada · ${fila.puntaje}/${TOTAL_PREGUNTAS} · ${porcentaje.toFixed(
            4,
          )}% · respuestas ${fila.respuestasImportadas}/${TOTAL_PREGUNTAS}`,
        );
      } catch (error) {
        filasFallidas += 1;

        console.error(
          `   ❌ FALLÓ fila ${fila.filaExcel}: ${
            error instanceof Error
              ? error.message
              : String(error)
          }`,
        );
      }
    }

    const conflictosResultado:
      Array<{
        objetivoId: number;
        envios: number[];
      }> = [];

    /*
     * Sólo asignamos resultado oficial automáticamente
     * si TODAS las filas terminaron correctamente.
     *
     * Esto evita que una importación parcial seleccione
     * como oficial el primer envío de un objetivo que
     * posteriormente tendrá un segundo envío.
     */
    if (filasFallidas === 0) {
      for (
        const objetivoId
        of objetivosTocados
      ) {
        const objetivo =
          await prisma.objetivoAuditoria.findUnique({
            where: {
              id: objetivoId,
            },
            select: {
              id: true,
              envioResultadoId:
                true,
            },
          });

        if (!objetivo) {
          continue;
        }

        const envios =
          await prisma.envioAuditoria.findMany({
            where: {
              objetivoAuditoriaId:
                objetivoId,
              invalidadoEn: null,
            },
            select: {
              id: true,
            },
            orderBy: {
              recibidoEn: 'asc',
            },
          });

        /*
         * Si alguien ya eligió manualmente un resultado,
         * jamás lo reemplazamos.
         */
        if (
          objetivo.envioResultadoId
        ) {
          continue;
        }

        if (
          envios.length === 1
        ) {
          await prisma.objetivoAuditoria.update({
            where: {
              id: objetivoId,
            },
            data: {
              envioResultadoId:
                envios[0].id,
            },
          });
        } else if (
          envios.length > 1
        ) {
          conflictosResultado.push({
            objetivoId,
            envios:
              envios.map(
                (envio) =>
                  envio.id,
              ),
          });
        }
      }

      /*
       * Estado actual.
       * KAPPA conserva todo su histórico pero ya no
       * participa en auditorías futuras.
       */
      for (
        const config
        of AREAS
      ) {
        const areas =
          await prisma.area.findMany({
            where: {
              tipo:
                TipoArea.OPERATIVA,
            },
          });

        const area =
          areas.find(
            (actual) =>
              normalizarClave(
                actual.nombre,
              ) ===
              normalizarClave(
                config.nombre,
              ),
          );

        if (
          area &&
          area.activo !==
            config.activaActual
        ) {
          await prisma.area.update({
            where: {
              id: area.id,
            },
            data: {
              activo:
                config.activaActual,
            },
          });
        }
      }
    }

    console.log('');
    console.log(
      '==============================================',
    );
    console.log(
      ' IMPORTACIÓN OPERATIVA TERMINADA',
    );
    console.log(
      '==============================================',
    );

    console.log(
      `Envíos creados: ${creados}`,
    );

    console.log(
      `Ya existentes: ${existentes}`,
    );

    console.log(
      `Filas fallidas: ${filasFallidas}`,
    );

    console.log(
      `Fotos creadas: ${fotosCreadas}`,
    );

    console.log(
      `Objetivos con conflicto de resultado: ${conflictosResultado.length}`,
    );

    if (
      conflictosResultado.length >
      0
    ) {
      console.log('');
      console.log(
        'NO se eligió automáticamente envioResultadoId para:',
      );

      for (
        const conflicto
        of conflictosResultado
      ) {
        console.log(
          `- Objetivo #${conflicto.objetivoId}: envíos ${conflicto.envios.join(
            ', ',
          )}`,
        );
      }
    }

    if (
      filasFallidas > 0
    ) {
      throw new Error(
        `La importación terminó con ${filasFallidas} filas fallidas. Corrige y vuelve a ejecutar.`,
      );
    }
  };

const main =
  async () => {
    console.log(
      `Archivo: ${rutaArchivo}`,
    );

    console.log(
      `Modo: ${
        APPLY
          ? 'APPLY'
          : 'DRY RUN'
      }`,
    );

    const analisis =
      analizarExcel(
        rutaArchivo,
      );

    if (
      analisis.errores.length >
      0
    ) {
      imprimirDryRun(
        analisis,
        {
          nuevas: [],
          reutilizadas: [],
          coexistentesAdministrativas:
            [],
        },
        'NO VALIDADO',
      );

      throw new Error(
        `Se detectaron ${analisis.errores.length} errores en el XLSX.`,
      );
    }

    /*
     * PRE-FLIGHT completo antes de cualquier INSERT.
     */
    verificarCloudinary(
      analisis.totalFotos,
    );

    const creador =
      await obtenerCreador();

    const areasBd =
      await preflightAreas();

    const formularioPreflight =
      await prepararFormularioOperativo(
        creador.id,
        analisis.preguntasTexto,
        false,
      );

    imprimirDryRun(
      analisis,
      areasBd,
      formularioPreflight.estado,
    );

    console.log(
      `Preflight BD: creador=${creador.nombre}`,
    );

    console.log(
      `Cloudinary: ${
        SKIP_PHOTOS
          ? 'OMITIDO'
          : 'CONFIGURADO'
      }`,
    );

    if (!APPLY) {
      console.log('');
      console.log(
        '✅ DRY RUN terminado.',
      );

      console.log(
        'MySQL no fue modificado.',
      );

      console.log(
        'Cloudinary no fue modificado.',
      );

      return;
    }

    console.log('');
    console.log(
      '⚠️ APPLY habilitado: se modificarán MySQL y Cloudinary.',
    );

    await aplicarImportacion(
      analisis,
    );
  };

main()
  .catch((error) => {
    console.error('');
    console.error(
      'IMPORTACIÓN CANCELADA',
    );

    console.error(
      error instanceof Error
        ? error.message
        : String(error),
    );

    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
