import { createHash, randomInt } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';

import * as XLSX from 'xlsx';

import { cloudinary } from '../src/config/cloudinary';
import { env } from '../src/config/env';
import { prisma } from '../src/db';
import {
  AlcanceFormulario,
  OrigenEnvioAuditoria,
  RolUsuario,
  TipoArea,
} from '../src/generated/prisma/enums';

const FORMULARIO_SLUG = 'evaluacion-5s-administrativa';
const NUMERO_VERSION_HISTORICA = 1;
const TOTAL_PREGUNTAS = 23;

type Celda = string | number | boolean | Date | null | undefined;

type FechaSimple = {
  anio: number;
  mes: number;
  dia: number;
};

type AreaConfig = {
  codigo: string;
  nombre: string;
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
  resumenSolamente: boolean;
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

const AREAS: AreaConfig[] = [
  {
    codigo: 'ADM',
    nombre: 'ADMINISTRACION',
  },
  {
    codigo: 'CAL-MESAS-PROD',
    nombre: 'CALIDAD MESAS DE TRABAJO EN PRODUCCION',
  },
  {
    codigo: 'CAP-HUM-VIG',
    nombre: 'CAPITAL HUMANO - VIGILANCIA',
  },
  {
    codigo: 'IMG-DISENO',
    nombre: 'IMAGEN - DISEÑO',
  },
  {
    codigo: 'MANT',
    nombre: 'MANTENIMIENTO',
  },
  {
    codigo: 'OF-ACC-ADORNO-PESP',
    nombre: 'OFICINA ACC- ADORNO - PESPUNTE',
  },
  {
    codigo: 'OF-CALIDAD-SALA',
    nombre: 'OFICINA CALIDAD- SALA DE JUNTAS',
  },
  {
    codigo: 'OF-BOLSAS-CONS-VIG',
    nombre: 'OFICINA DE BOLSAS-CONSULTORIO-VIGILANCIA',
  },
  {
    codigo: 'OF-SIGMA-VIG',
    nombre: 'OFICINA DE SIGMA - VIGILANCIA',
  },
  {
    codigo: 'OF-DES-COSTOS-PROC',
    nombre: 'OFICINA DESARROLLO - ING. COSTOS - ING. PROCESOS',
  },
  {
    codigo: 'OF-LOG-VIG-RECEP',
    nombre: 'OFICINA LOGISTICA - VIGILANCIA - RECEPCIÓN',
  },
  {
    codigo: 'PPCP-MAQ-DIR',
    nombre: 'PPCP-MAQUILAS-DIRECCION',
  },
];

const args = process.argv.slice(2);

const rutaArchivo = args.find((arg) => !arg.startsWith('--'));

const APPLY = args.includes('--apply');
const SKIP_PHOTOS = args.includes('--skip-photos');
const ALLOW_MISSING_PHOTOS = args.includes('--allow-missing-photos');

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

const areasPorClave = new Map(
  AREAS.map((area) => [normalizarClave(area.nombre), area]),
);

const resolverArea = (nombreOriginal: string) => {
  const clave = normalizarClave(nombreOriginal);
  const area = areasPorClave.get(clave);

  if (!area) {
    throw new Error(
      `Área no reconocida: "${nombreOriginal}" (clave normalizada: "${clave}")`,
    );
  }

  return area;
};

const uuidDeterminista = (entrada: string) => {
  const hash = createHash('sha1').update(entrada).digest();
  const bytes = Buffer.from(hash.subarray(0, 16));

  // UUID versión 5 / variante RFC 4122.
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
      throw new Error(`Fecha Excel inválida en ${nombreCampo}: ${valor}`);
    }

    return {
      anio: partes.y,
      mes: partes.m,
      dia: partes.d,
    };
  }

  const texto = normalizarEspacios(valor);

  const ddmmyyyy = texto.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);

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
      throw new Error(`Fecha Excel inválida en ${nombreCampo}: ${valor}`);
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
    throw new Error(`Puntaje inválido: "${String(valor)}"`);
  }

  return numero;
};

const parseCumple = (
  valor: Celda,
): boolean | null => {
  const texto = normalizarClave(valor);

  if (!texto) return null;

  if (texto === 'SI') return true;
  if (texto === 'NO') return false;

  throw new Error(`Respuesta distinta de SÍ/NO: "${String(valor)}"`);
};

const extraerUrls = (valor: Celda): string[] => {
  let texto = String(valor ?? '').trim();

  if (!texto) return [];

  // Tolera exportaciones donde aparezcan barras invertidas escapadas.
  texto = texto.replace(/\\([_:/])/g, '$1');

  return texto
    .split(/,\s*(?=https?:\/\/)/i)
    .map((url) => url.trim())
    .filter((url) => /^https?:\/\//i.test(url));
};

const obtenerUltimoDiaMes = (anio: number, mes: number) =>
  mes === 2 ? 28 : new Date(anio, mes, 0).getDate();
const calcularCorte = (fecha: FechaSimple): 1 | 2 =>
  fecha.dia <= 15 ? 1 : 2;

const obtenerLimitesPeriodo = (
  anio: number,
  mes: number,
  corte: 1 | 2,
) => {
  const ultimoDia = obtenerUltimoDiaMes(anio, mes);

  if (corte === 1) {
    return {
      iniciaEn: new Date(anio, mes - 1, 1, 0, 0, 0, 0),
      terminaEn: new Date(anio, mes - 1, 15, 23, 59, 59, 999),
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
    fuente: 'TALLY_ADMINISTRATIVA',
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
    throw new Error(`No existe el archivo: ${ruta}`);
  }

  const workbook = XLSX.read(readFileSync(ruta), {
    type: 'buffer',
    cellDates: true,
  });

  const nombreHoja = workbook.SheetNames[0];

  if (!nombreHoja) {
    throw new Error('El Excel no contiene hojas.');
  }

  const hoja = workbook.Sheets[nombreHoja];

  const matriz = XLSX.utils.sheet_to_json(hoja, {
    header: 1,
    raw: true,
    defval: null,
  }) as Celda[][];

  if (matriz.length < 2) {
    throw new Error('El Excel no contiene registros.');
  }

  return {
    nombreHoja,
    matriz,
  };
};

const analizarExcel = (ruta: string) => {
  const { nombreHoja, matriz } = leerArchivo(ruta);

  const headers = matriz[0].map(normalizarEspacios);

  const indiceHeader = new Map<string, number>();

  headers.forEach((header, index) => {
    indiceHeader.set(header, index);
  });

  const indiceSubmitted = indiceHeader.get('Submitted at');
  const indiceArea = indiceHeader.get('Área');
  const indiceAuditor = indiceHeader.get('Auditor(es)');
  const indiceFecha = indiceHeader.get('Fecha');
  const indicePuntaje = indiceHeader.get('Puntaje 5S');

  if (
    indiceSubmitted === undefined ||
    indiceArea === undefined ||
    indiceAuditor === undefined ||
    indiceFecha === undefined ||
    indicePuntaje === undefined
  ) {
    throw new Error(
      'Faltan una o más columnas principales: Submitted at, Área, Auditor(es), Fecha, Puntaje 5S.',
    );
  }

  const respuestasColumnas = new Map<number, number>();
  const hallazgosColumnas = new Map<number, number>();
  const evidenciasColumnas = new Map<number, number>();

  headers.forEach((header, index) => {
    const respuesta = header.match(/^(\d+)\./);

    if (respuesta) {
      const numero = Number(respuesta[1]);

      if (numero >= 1 && numero <= TOTAL_PREGUNTAS) {
        respuestasColumnas.set(numero, index);
      }
    }

    const hallazgo = header.match(/^Hallazgo Detectado\s+(\d+)$/i);

    if (hallazgo) {
      hallazgosColumnas.set(Number(hallazgo[1]), index);
    }

    const evidencia = header.match(/^Evidencia\s+(\d+)$/i);

    if (evidencia) {
      evidenciasColumnas.set(Number(evidencia[1]), index);
    }
  });

  if (respuestasColumnas.size !== TOTAL_PREGUNTAS) {
    throw new Error(
      `Se esperaban ${TOTAL_PREGUNTAS} columnas de respuesta y se encontraron ${respuestasColumnas.size}.`,
    );
  }

  const filas: FilaHistorica[] = [];
  const errores: string[] = [];

  for (let i = 1; i < matriz.length; i += 1) {
    const fila = matriz[i];
    const filaExcel = i + 1;

    const estaVacia = fila.every(
      (celda) => celda === null || normalizarEspacios(celda) === '',
    );

    if (estaVacia) continue;

    try {
      const areaOriginal = normalizarEspacios(fila[indiceArea]);
      const auditor = normalizarEspacios(fila[indiceAuditor]);

      if (!areaOriginal) {
        throw new Error('Área vacía');
      }

      if (!auditor) {
        throw new Error('Auditor(es) vacío');
      }

      const area = resolverArea(areaOriginal);
      const fechaPeriodo = parseFechaSimple(
        fila[indiceFecha],
        'Fecha',
      );

      const submittedAt = parseFechaHora(
        fila[indiceSubmitted],
        'Submitted at',
      );

      const puntaje = parsePuntaje(fila[indicePuntaje]);
      const corte = calcularCorte(fechaPeriodo);

      const respuestas: RespuestaHistorica[] = [];

      let respuestasContestadas = 0;

      for (let numero = 1; numero <= TOTAL_PREGUNTAS; numero += 1) {
        const indiceRespuesta = respuestasColumnas.get(numero);

        if (indiceRespuesta === undefined) {
          throw new Error(
            `No se encontró la columna de respuesta ${numero}`,
          );
        }

        const cumple = parseCumple(fila[indiceRespuesta]);

        if (cumple === null) {
          continue;
        }

        respuestasContestadas += 1;

        const indiceHallazgo = hallazgosColumnas.get(numero);
        const indiceEvidencia = evidenciasColumnas.get(numero);

        const hallazgo =
          indiceHallazgo === undefined
            ? null
            : normalizarTexto(fila[indiceHallazgo]);

        const evidencias =
          indiceEvidencia === undefined
            ? []
            : extraerUrls(fila[indiceEvidencia]);

        // En el Tally viejo, 1-20 sí tenían columna de hallazgo.
        // Si eran NO, preservamos la regla de integridad histórica.
        if (!cumple && numero <= 20 && !hallazgo) {
          throw new Error(
            `Pregunta ${numero}: respuesta NO sin hallazgo histórico`,
          );
        }

        respuestas.push({
          numero,
          cumple,
          hallazgo,
          evidencias,
        });
      }

      const resumenSolamente = respuestasContestadas === 0;

      if (
        respuestasContestadas !== 0 &&
        respuestasContestadas !== TOTAL_PREGUNTAS
      ) {
        throw new Error(
          `Auditoría parcial: ${respuestasContestadas}/${TOTAL_PREGUNTAS} respuestas`,
        );
      }

      if (!resumenSolamente) {
        const puntosCalculados = respuestas.filter(
          (respuesta) => respuesta.cumple,
        ).length;

        if (puntosCalculados !== puntaje) {
          throw new Error(
            `Puntaje Excel=${puntaje}, pero las respuestas suman=${puntosCalculados}`,
          );
        }
      }

      if (puntaje < 0 || puntaje > TOTAL_PREGUNTAS) {
        throw new Error(
          `Puntaje fuera de rango: ${puntaje}/${TOTAL_PREGUNTAS}`,
        );
      }

      const identificadorCliente = crearIdentidadFila(
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
        resumenSolamente,
        respuestas,
      });
    } catch (error) {
      errores.push(
        `Fila ${filaExcel}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  const grupos = new Map<string, FilaHistorica[]>();

  for (const fila of filas) {
    const clave = [
      fila.fechaPeriodo.anio,
      String(fila.fechaPeriodo.mes).padStart(2, '0'),
      fila.corte,
      fila.area.codigo,
    ].join(':');

    const actuales = grupos.get(clave) ?? [];
    actuales.push(fila);
    grupos.set(clave, actuales);
  }

  const duplicadosPeriodo = [...grupos.entries()]
    .filter(([, grupo]) => grupo.length > 1)
    .map(([clave, grupo]) => ({
      clave,
      filas: grupo.map((item) => ({
        filaExcel: item.filaExcel,
        submittedAt: item.submittedAt.toISOString(),
        auditor: item.auditor,
        puntaje: item.puntaje,
      })),
    }));

  const totalFotos = filas.reduce(
    (total, fila) =>
      total +
      fila.respuestas.reduce(
        (subtotal, respuesta) =>
          subtotal + respuesta.evidencias.length,
        0,
      ),
    0,
  );

  return {
    nombreHoja,
    filas,
    errores,
    duplicadosPeriodo,
    totalFotos,
    resumenes: filas.filter((fila) => fila.resumenSolamente).length,
    completas: filas.filter((fila) => !fila.resumenSolamente).length,
  };
};

const obtenerCreador = async () => {
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

  if (superAdmin) return superAdmin;

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
      'No existe SUPER_ADMIN ni ADMINISTRADOR activo. Ejecuta primero el flujo de creación del SUPER_ADMIN.',
    );
  }

  return administrador;
};

const obtenerVersionAdministrativa = async () => {
  const formulario = await prisma.formulario.findUnique({
    where: {
      slug: FORMULARIO_SLUG,
    },
    include: {
      versiones: {
        where: {
          numeroVersion: NUMERO_VERSION_HISTORICA,
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
      `No existe el formulario "${FORMULARIO_SLUG}". Debes poblar primero los formularios 5S.`,
    );
  }

  if (
    formulario.alcance !== AlcanceFormulario.ADMINISTRATIVO &&
    formulario.alcance !== AlcanceFormulario.AMBOS
  ) {
    throw new Error(
      `El formulario ${FORMULARIO_SLUG} no tiene alcance administrativo.`,
    );
  }

  const version = formulario.versiones[0];

  if (!version) {
    throw new Error(
      `No existe V${NUMERO_VERSION_HISTORICA} del formulario administrativo.`,
    );
  }

  const preguntas = version.secciones.flatMap(
    (seccion) => seccion.preguntas,
  );

  if (preguntas.length !== TOTAL_PREGUNTAS) {
    throw new Error(
      `V${NUMERO_VERSION_HISTORICA} tiene ${preguntas.length} preguntas; se esperaban ${TOTAL_PREGUNTAS}.`,
    );
  }

  return {
    formulario,
    version,
    preguntas,
  };
};

const obtenerOCrearArea = async (config: AreaConfig) => {
  const existentePorCodigo = await prisma.area.findUnique({
    where: {
      codigo: config.codigo,
    },
  });

  if (existentePorCodigo) {
    if (existentePorCodigo.tipo !== TipoArea.ADMINISTRATIVA) {
      throw new Error(
        `El área ${config.codigo} ya existe pero no es ADMINISTRATIVA.`,
      );
    }

    return existentePorCodigo;
  }

  const existentes = await prisma.area.findMany();

  const existentePorNombre = existentes.find(
    (area) =>
      normalizarClave(area.nombre) === normalizarClave(config.nombre),
  );

  if (existentePorNombre) {
    if (existentePorNombre.tipo !== TipoArea.ADMINISTRATIVA) {
      throw new Error(
        `El área "${config.nombre}" existe con otro tipo.`,
      );
    }

    return existentePorNombre;
  }

  for (let intento = 0; intento < 20; intento += 1) {
    const codigoVerificacion = generarCodigoVerificacion();

    const codigoUsado = await prisma.area.findUnique({
      where: {
        codigoVerificacion,
      },
      select: {
        id: true,
      },
    });

    if (codigoUsado) continue;

    return prisma.area.create({
      data: {
        codigo: config.codigo,
        nombre: config.nombre,
        tipo: TipoArea.ADMINISTRATIVA,
        activo: true,
        codigoVerificacion,
      },
    });
  }

  throw new Error(
    `No se pudo generar codigoVerificacion único para ${config.nombre}.`,
  );
};

const construirContextoPeriodo = (
  fila: FilaHistorica,
  versionFormularioId: number,
) => {
  const { anio, mes } = fila.fechaPeriodo;
  const periodo = fila.corte;
  const limites = obtenerLimitesPeriodo(anio, mes, periodo);

  return {
    anio,
    mes,
    periodo,
    versionFormularioId,
    iniciaEn: limites.iniciaEn,
    terminaEn: limites.terminaEn,
  };
};

const asegurarObjetivo = async (
  fila: FilaHistorica,
  areaId: number,
  contexto: ReturnType<typeof construirContextoPeriodo>,
) => {
  const existente = await prisma.objetivoAuditoria.findFirst({
    where: {
      areaId,
      anio: contexto.anio,
      mes: contexto.mes,
      periodo: contexto.periodo,
    },
  });

  if (existente) {
    if (existente.versionFormularioId !== contexto.versionFormularioId) {
      throw new Error(
        `El objetivo existente #${existente.id} ya apunta a otra versión administrativa.`,
      );
    }

    return existente;
  }

  return prisma.objetivoAuditoria.create({
    data: {
      areaId,
      anio: contexto.anio,
      mes: contexto.mes,
      periodo: contexto.periodo,
      versionFormularioId: contexto.versionFormularioId,
      iniciaEn: contexto.iniciaEn,
      terminaEn: contexto.terminaEn,
      codigoAreaSnapshot: fila.area.codigo,
      nombreAreaSnapshot: fila.area.nombre,
      tipoAreaSnapshot: TipoArea.ADMINISTRATIVA,
    },
  });
};

const subirFotosFila = async (
  fila: FilaHistorica,
): Promise<FotoSubida[]> => {
  if (SKIP_PHOTOS) return [];

  const planes = fila.respuestas.flatMap((respuesta) =>
    respuesta.evidencias.map((url, indice) => ({
      preguntaNumero: respuesta.numero,
      indice,
      url,
    })),
  );

  if (planes.length === 0) return [];

  if (!env.CLOUDINARY_ENABLED) {
    throw new Error(
      'Hay fotografías para importar pero CLOUDINARY_ENABLED=false.',
    );
  }

  const fotos: FotoSubida[] = [];

  for (const plan of planes) {
    const identificadorCliente = uuidDeterminista(
      [
        'TALLY_FOTO_ADMIN',
        fila.identificadorCliente,
        plan.preguntaNumero,
        plan.indice,
        plan.url,
      ].join(':'),
    );

    const publicId = `tally-${identificadorCliente.replace(/-/g, '')}`;

    const folder = [
      'encuestas-5s',
      'historico-tally',
      'administrativa',
      String(fila.fechaPeriodo.anio),
      String(fila.fechaPeriodo.mes).padStart(2, '0'),
      `periodo-${fila.corte}`,
      fila.area.codigo.toLowerCase(),
      `pregunta-${plan.preguntaNumero}`,
    ].join('/');

    try {
      const resultado = await cloudinary.uploader.upload(plan.url, {
        resource_type: 'image',
        folder,
        public_id: publicId,
        overwrite: true,
        unique_filename: false,
        use_filename: false,
      });

      fotos.push({
        identificadorCliente,
        preguntaNumero: plan.preguntaNumero,
        publicIdCloudinary: resultado.public_id,
        assetIdCloudinary: resultado.asset_id ?? null,
        formato: resultado.format ?? null,
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
      });

      console.log(
        `   📷 Fila ${fila.filaExcel} · P${plan.preguntaNumero} · OK`,
      );
    } catch (error) {
      const mensaje =
        error instanceof Error ? error.message : String(error);

      console.error(
        `   ❌ Foto fila ${fila.filaExcel} · P${plan.preguntaNumero}: ${mensaje}`,
      );

      if (!ALLOW_MISSING_PHOTOS) {
        throw new Error(
          `No se pudieron migrar todas las fotos de la fila ${fila.filaExcel}.`,
          { cause: error },
        );
      }
    }
  }

  return fotos;
};

const imprimirDryRun = (
  analisis: ReturnType<typeof analizarExcel>,
) => {
  console.log('');
  console.log('==============================================');
  console.log(' DRY RUN · HISTÓRICO TALLY ADMINISTRATIVO');
  console.log('==============================================');
  console.log(`Hoja: ${analisis.nombreHoja}`);
  console.log(`Auditorías válidas: ${analisis.filas.length}`);
  console.log(`Completas: ${analisis.completas}`);
  console.log(`Sólo resumen: ${analisis.resumenes}`);
  console.log(`Evidencias/fotos detectadas: ${analisis.totalFotos}`);
  console.log(
    `Áreas detectadas: ${
      new Set(analisis.filas.map((fila) => fila.area.codigo)).size
    }`,
  );
  console.log(
    `Periodos con más de un envío: ${analisis.duplicadosPeriodo.length}`,
  );

  if (analisis.duplicadosPeriodo.length > 0) {
    console.log('');
    console.log('CONFLICTOS DE ENVIO RESULTADO:');

    for (const conflicto of analisis.duplicadosPeriodo) {
      console.log(`- ${conflicto.clave}`);

      for (const fila of conflicto.filas) {
        console.log(
          `    fila=${fila.filaExcel} auditor="${fila.auditor}" puntaje=${fila.puntaje} submitted=${fila.submittedAt}`,
        );
      }
    }
  }

  if (analisis.errores.length > 0) {
    console.log('');
    console.log('ERRORES:');

    for (const error of analisis.errores) {
      console.log(`- ${error}`);
    }
  }

  console.log('');
};

const aplicarImportacion = async (
  analisis: ReturnType<typeof analizarExcel>,
) => {
  if (analisis.errores.length > 0) {
    throw new Error(
      'Existen errores en el Excel. No se aplicará la importación.',
    );
  }

  const creador = await obtenerCreador();
  const { version, preguntas } =
    await obtenerVersionAdministrativa();

  console.log(
    `Creador técnico: ${creador.nombre} (${creador.rol})`,
  );
  console.log(
    `Formulario histórico: ${FORMULARIO_SLUG} V${version.numeroVersion}`,
  );

  const areasCache = new Map<string, Awaited<ReturnType<typeof obtenerOCrearArea>>>();
  const periodosCache = new Map<string, ReturnType<typeof construirContextoPeriodo>>();
  const objetivosTocados = new Set<number>();

  let creados = 0;
  let existentes = 0;
  let fotosCreadas = 0;
  let filasFallidas = 0;

  const filasOrdenadas = [...analisis.filas].sort(
    (a, b) => a.submittedAt.getTime() - b.submittedAt.getTime(),
  );

  for (const fila of filasOrdenadas) {
    console.log('');
    console.log(
      `Fila ${fila.filaExcel} · ${fila.area.nombre} · ${fila.fechaPeriodo.anio}-${String(
        fila.fechaPeriodo.mes,
      ).padStart(2, '0')} P${fila.corte}`,
    );

    const existente = await prisma.envioAuditoria.findUnique({
      where: {
        identificadorCliente: fila.identificadorCliente,
      },
      select: {
        id: true,
        objetivoAuditoriaId: true,
      },
    });

    if (existente) {
      console.log(`   ↪ Ya importada. Envío #${existente.id}`);
      existentes += 1;
      objetivosTocados.add(existente.objetivoAuditoriaId);
      continue;
    }

    try {
      let area = areasCache.get(fila.area.codigo);

      if (!area) {
        area = await obtenerOCrearArea(fila.area);
        areasCache.set(fila.area.codigo, area);
      }

      const clavePeriodo = `${fila.fechaPeriodo.anio}-${fila.fechaPeriodo.mes}-${fila.corte}`;

      let contextoPeriodo = periodosCache.get(clavePeriodo);

      if (!contextoPeriodo) {
        contextoPeriodo = construirContextoPeriodo(
          fila,
          version.id,
        );

        periodosCache.set(clavePeriodo, contextoPeriodo);
      }

      const objetivo = await asegurarObjetivo(
        fila,
        area.id,
        contextoPeriodo,
      );

      objetivosTocados.add(objetivo.id);

      // Cloudinary siempre fuera de la transacción de Prisma.
      const fotos = await subirFotosFila(fila);

      const porcentaje =
        (fila.puntaje / TOTAL_PREGUNTAS) * 100;

      await prisma.$transaction(async (tx) => {
        const envio = await tx.envioAuditoria.create({
          data: {
            identificadorCliente: fila.identificadorCliente,
            objetivoAuditoriaId: objetivo.id,

            asignacionAuditoriaId: null,
            enviadoPorUsuarioId: null,
            enlaceInvitadoId: null,

            nombreAuditorSnapshot: fila.auditor.slice(0, 160),
            origen: OrigenEnvioAuditoria.INVITADO,

            puntajeObtenido: fila.puntaje.toFixed(4),
            puntajePosible: TOTAL_PREGUNTAS.toFixed(4),
            porcentaje: porcentaje.toFixed(4),

            // Histórico Tally:
            // Submitted at representa el instante real en que
            // la auditoría fue enviada/recibida.
            //
            // verificadoEn se llena con la misma fecha porque
            // el schema actual lo requiere. Esto NO significa
            // que existiera QR en el sistema antiguo.
            finalizadoEn: fila.submittedAt,
            verificadoEn: fila.submittedAt,
            recibidoEn: fila.submittedAt,
          },
        });

        if (!fila.resumenSolamente) {
          for (const respuesta of fila.respuestas) {
            const pregunta =
              preguntas[respuesta.numero - 1];

            if (!pregunta) {
              throw new Error(
                `No existe PreguntaFormulario para posición ${respuesta.numero}.`,
              );
            }

            const respuestaCreada =
              await tx.respuestaAuditoria.create({
                data: {
                  envioAuditoriaId: envio.id,
                  preguntaFormularioId: pregunta.id,
                  cumple: respuesta.cumple,
                  hallazgo: respuesta.hallazgo,
                },
              });

            const fotosRespuesta = fotos.filter(
              (foto) =>
                foto.preguntaNumero === respuesta.numero,
            );

            for (const foto of fotosRespuesta) {
              await tx.fotoAuditoria.create({
                data: {
                  identificadorCliente:
                    foto.identificadorCliente,
                  respuestaAuditoriaId:
                    respuestaCreada.id,
                  publicIdCloudinary:
                    foto.publicIdCloudinary,
                  assetIdCloudinary:
                    foto.assetIdCloudinary,
                  formato: foto.formato,
                  bytes: foto.bytes,
                  ancho: foto.ancho,
                  alto: foto.alto,
                  subidaEn: foto.subidaEn,
                },
              });

              fotosCreadas += 1;
            }
          }
        }

        await tx.registroAuditoria.create({
          data: {
            accion: 'IMPORTAR_HISTORICO_TALLY_ADMINISTRATIVO',
            tipoEntidad: 'EnvioAuditoria',
            idEntidad: envio.id,
            datosNuevos: {
              fuente: 'TALLY',
              filaExcel: fila.filaExcel,
              areaOriginal: fila.areaOriginal,
              resumenSolamente: fila.resumenSolamente,
            },
          },
        });
      });

      creados += 1;
      console.log(
        `   ✅ Importada · ${fila.puntaje}/${TOTAL_PREGUNTAS} · ${porcentaje.toFixed(
          4,
        )}%`,
      );
    } catch (error) {
      filasFallidas += 1;

      console.error(
        `   ❌ FALLÓ fila ${fila.filaExcel}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  const conflictosResultado: Array<{
    objetivoId: number;
    envios: number[];
  }> = [];

  for (const objetivoId of objetivosTocados) {
    const objetivo = await prisma.objetivoAuditoria.findUnique({
      where: {
        id: objetivoId,
      },
      select: {
        id: true,
        envioResultadoId: true,
      },
    });

    if (!objetivo || objetivo.envioResultadoId) {
      continue;
    }

    const envios = await prisma.envioAuditoria.findMany({
      where: {
        objetivoAuditoriaId: objetivoId,
        invalidadoEn: null,
      },
      select: {
        id: true,
      },
      orderBy: {
        recibidoEn: 'asc',
      },
    });

    if (envios.length === 1) {
      await prisma.objetivoAuditoria.update({
        where: {
          id: objetivoId,
        },
        data: {
          envioResultadoId: envios[0].id,
        },
      });
    } else if (envios.length > 1) {
      conflictosResultado.push({
        objetivoId,
        envios: envios.map((envio) => envio.id),
      });
    }
  }

  console.log('');
  console.log('==============================================');
  console.log(' IMPORTACIÓN TERMINADA');
  console.log('==============================================');
  console.log(`Envíos creados: ${creados}`);
  console.log(`Ya existentes: ${existentes}`);
  console.log(`Filas fallidas: ${filasFallidas}`);
  console.log(`Fotos creadas: ${fotosCreadas}`);
  console.log(
    `Objetivos con conflicto de resultado: ${conflictosResultado.length}`,
  );

  if (conflictosResultado.length > 0) {
    console.log('');
    console.log(
      'Estos objetivos tienen más de un envío y NO se eligió automáticamente envioResultadoId:',
    );

    for (const conflicto of conflictosResultado) {
      console.log(
        `- Objetivo #${conflicto.objetivoId}: envíos ${conflicto.envios.join(
          ', ',
        )}`,
      );
    }
  }

  if (filasFallidas > 0) {
    throw new Error(
      `La importación terminó con ${filasFallidas} filas fallidas. Revisa el log y vuelve a ejecutar después de corregirlas.`,
    );
  }
};

const main = async () => {
  if (!rutaArchivo) {
    throw new Error(
      [
        'Debes indicar la ruta del Excel.',
        '',
        'Ejemplo:',
        'bun scripts/importar-historico-tally-administrativo.ts "C:\\Users\\...\\EVALUACION_5´S_ADMINISTRATIVA (1).xlsx"',
      ].join('\n'),
    );
  }

  console.log(`Archivo: ${rutaArchivo}`);
  console.log(`Modo: ${APPLY ? 'APPLY' : 'DRY RUN'}`);

  const analisis = analizarExcel(rutaArchivo);

  imprimirDryRun(analisis);

  if (analisis.errores.length > 0) {
    throw new Error(
      `Se detectaron ${analisis.errores.length} errores. No continúo.`,
    );
  }

  // También comprobamos la BD durante dry-run:
  // formulario V1 + creador existente.
  const creador = await obtenerCreador();
  const version = await obtenerVersionAdministrativa();

  console.log(
    `Preflight BD: creador=${creador.nombre}, formulario=V${version.version.numeroVersion}, preguntas=${version.preguntas.length}`,
  );

  if (!APPLY) {
    console.log('');
    console.log(
      '✅ DRY RUN terminado. No se modificó MySQL ni Cloudinary.',
    );
    console.log(
      'Cuando revises el reporte, vuelve a ejecutarlo agregando --apply.',
    );
    return;
  }

  console.log('');
  console.log(
    '⚠️ APPLY habilitado: se modificarán MySQL y Cloudinary.',
  );

  await aplicarImportacion(analisis);
};

main()
  .catch((error) => {
    console.error('');
    console.error('IMPORTACIÓN CANCELADA');
    console.error(
      error instanceof Error ? error.message : String(error),
    );

    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
