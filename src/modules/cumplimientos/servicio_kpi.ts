import type { PrismaTransaction } from '../../db';
import { prisma } from '../../db';
import { Prisma } from '../../generated/prisma/client';
import { EstadoAsignacionAuditoria, TipoArea } from '../../generated/prisma/enums';
import { calcularCierreConGracia, calcularResultadoMensualCanonico } from '../../utils/periodos';

export { calcularResultadoMensualCanonico };

export const CORTE_P1 = 1;
export const CORTE_P2 = 2;

export function calcularKpiFinal(cumplimiento: number | null, promedioAreas: number | null): number | null {
  if (cumplimiento !== null && promedioAreas !== null) {
    return Number(((cumplimiento + promedioAreas) / 2).toFixed(4));
  }
  if (cumplimiento !== null && promedioAreas === null) {
    return Number(cumplimiento.toFixed(4));
  }
  if (cumplimiento === null && promedioAreas !== null) {
    return Number(promedioAreas.toFixed(4));
  }
  return null;
}

export type EstadoChipCumplimiento = 'A_TIEMPO' | 'TARDE' | 'NO_REALIZADA' | 'PENDIENTE' | 'NO_APLICA';

export function determinarEstadoChip(
  objetivo: { terminaEn: Date; envioResultadoId?: number | null; canceladoEn?: Date | null },
  envioResultado: { realizadaATiempo: boolean; invalidadoEn: Date | null } | null,
  ahora = new Date(),
  reabiertaHasta: Date | null = null,
): EstadoChipCumplimiento {
  if (objetivo.canceladoEn) {
    return 'NO_APLICA';
  }
  if (envioResultado && !envioResultado.invalidadoEn) {
    return envioResultado.realizadaATiempo ? 'A_TIEMPO' : 'TARDE';
  }

  const cierreGracia = calcularCierreConGracia(objetivo.terminaEn);
  const limiteEfectivo = reabiertaHasta && new Date(reabiertaHasta) > cierreGracia ? new Date(reabiertaHasta) : cierreGracia;

  if (ahora > limiteEfectivo) {
    return 'NO_REALIZADA';
  }

  return 'PENDIENTE';
}

export interface CumplimientoCalculado {
  usuario: {
    id: number;
    nombre: string;
    nombreUsuario: string;
    correo: string | null;
    rol: string;
    seEvalua: boolean;
    esComodin: boolean;
  };
  usuarioId: number;
  anio: number;
  mes: number;
  seEvaluaSnapshot: boolean;
  auditoriasEsperadas: number;
  auditoriasATiempo: number;
  porcentajeCumplimiento: number | null;
  promedioAreas: number | null;
  areasConResultado: number;
  kpiFinal: number | null;
  calculadoEn: Date;
  detallesAreas: Array<{
    areaId: number;
    codigoAreaSnapshot: string;
    nombreAreaSnapshot: string;
    tipoAreaSnapshot: TipoArea;
    resultadoMensualUtilizado: number;
  }>;
}

/**
 * Calcula en memoria (operación pura de lectura sin mutaciones) el cumplimiento y KPI 50/50 de un usuario para un mes dado.
 * Respeta snapshots históricos de áreas ya liquidadas si existen en la BD.
 */
export const calcularCumplimientoUsuarioEnMemoria = async (
  tx: PrismaTransaction | typeof prisma,
  usuarioId: number,
  anio: number,
  mes: number,
  forzarRecalculoAreas = false,
  ahora = new Date(),
): Promise<CumplimientoCalculado> => {
  const usuario = await tx.usuario.findUniqueOrThrow({
    where: { id: usuarioId },
    include: {
      areasUsuario: {
        where: {
          area: { activo: true },
        },
        include: {
          area: {
            select: { id: true, codigo: true, nombre: true, tipo: true, activo: true },
          },
        },
      },
    },
  });

  // Verificar si ya existe un snapshot previo de este usuario para este mes
  const cumplimientoExistente = await tx.cumplimientoMensualUsuario.findUnique({
    where: {
      usuarioId_anio_mes: {
        usuarioId,
        anio,
        mes,
      },
    },
    include: {
      detallesAreas: true,
    },
  });

  // Si ya existía un snapshot histórico y no se fuerza recálculo de áreas, conservar seEvaluaSnapshot
  const seEvaluaSnapshot = cumplimientoExistente && !forzarRecalculoAreas
    ? cumplimientoExistente.seEvaluaSnapshot
    : usuario.seEvalua;

  // COMPONENTE 1: AUDITORÍAS ORDINARIAS
  // Buscamos asignaciones donde el usuario sea responsableCumplimientoId (o auditorId si responsableCumplimientoId es null)
  // Solo se consideran auditorías de áreas activas
  const asignacionesResponsable = await tx.asignacionAuditoria.findMany({
    where: {
      estado: { not: EstadoAsignacionAuditoria.CANCELADA },
      objetivoAuditoria: {
        anio,
        mes,
        canceladoEn: null,
        area: { activo: true },
      },
      OR: [
        { responsableCumplimientoId: usuarioId },
        { responsableCumplimientoId: null, auditorId: usuarioId },
      ],
    },
    include: {
      objetivoAuditoria: {
        include: {
          envioResultado: {
            select: { id: true, realizadaATiempo: true, invalidadoEn: true },
          },
        },
      },
    },
  });

  const auditoriasEsperadas = asignacionesResponsable.length;
  let auditoriasATiempo = 0;

  for (const asig of asignacionesResponsable) {
    const envio = asig.objetivoAuditoria.envioResultado;
    if (envio && !envio.invalidadoEn && envio.realizadaATiempo) {
      auditoriasATiempo += 1;
    }
  }

  const porcentajeCumplimiento = auditoriasEsperadas === 0
    ? null
    : Number(((auditoriasATiempo / auditoriasEsperadas) * 100).toFixed(4));

  // COMPONENTE 2: PROMEDIO DE ÁREAS A CARGO
  // Si ya existe snapshot previo con detallesAreas y no se fuerza recálculo de composición, usamos las áreas históricas
  const usarAreasHistoricas = Boolean(cumplimientoExistente && cumplimientoExistente.detallesAreas.length > 0 && !forzarRecalculoAreas);

  const areasEvaluadasConfig = usarAreasHistoricas
    ? cumplimientoExistente!.detallesAreas.map((da) => ({
        id: da.areaId,
        codigo: da.codigoAreaSnapshot,
        nombre: da.nombreAreaSnapshot,
        tipo: da.tipoAreaSnapshot,
      }))
    : usuario.areasUsuario.map((ua) => ua.area);

  const detallesAreasParaGuardar: Array<{
    areaId: number;
    codigoAreaSnapshot: string;
    nombreAreaSnapshot: string;
    tipoAreaSnapshot: TipoArea;
    resultadoMensualUtilizado: number;
  }> = [];

  let promedioAreas: number | null = null;
  let areasConResultado = 0;

  if (seEvaluaSnapshot && areasEvaluadasConfig.length > 0) {
    let sumaResultados = 0;

    for (const area of areasEvaluadasConfig) {
      const objetivosArea = await tx.objetivoAuditoria.findMany({
        where: {
          areaId: area.id,
          anio,
          mes,
        },
        include: {
          envioResultado: {
            select: { id: true, porcentaje: true, invalidadoEn: true, realizadaATiempo: true },
          },
          asignacionesAuditoria: {
            where: { estado: { not: EstadoAsignacionAuditoria.CANCELADA } },
            select: { reabiertaHasta: true },
            orderBy: { creadoEn: 'desc' },
            take: 1,
          },
        },
      });

      const p1 = objetivosArea.find((o) => o.periodo === CORTE_P1);
      const p2 = objetivosArea.find((o) => o.periodo === CORTE_P2);

      const envioP1 = p1?.envioResultado && !p1.envioResultado.invalidadoEn ? p1.envioResultado : null;
      const envioP2 = p2?.envioResultado && !p2.envioResultado.invalidadoEn ? p2.envioResultado : null;

      const p1Score = envioP1 ? Number(envioP1.porcentaje) : null;
      const p2Score = envioP2 ? Number(envioP2.porcentaje) : null;

      const asigP1 = p1?.asignacionesAuditoria?.[0] ?? null;
      const asigP2 = p2?.asignacionesAuditoria?.[0] ?? null;

      const chipP1 = p1
        ? (p1.canceladoEn ? 'NO_APLICA' : determinarEstadoChip(p1, envioP1, ahora, asigP1?.reabiertaHasta ?? null))
        : 'NO_APLICA';
      const chipP2 = p2
        ? (p2.canceladoEn ? 'NO_APLICA' : determinarEstadoChip(p2, envioP2, ahora, asigP2?.reabiertaHasta ?? null))
        : 'NO_APLICA';

      const resultadoArea = calcularResultadoMensualCanonico(p1Score, p2Score, chipP1, chipP2);

      if (resultadoArea !== null) {
        areasConResultado += 1;
        sumaResultados += resultadoArea;
        detallesAreasParaGuardar.push({
          areaId: area.id,
          codigoAreaSnapshot: area.codigo,
          nombreAreaSnapshot: area.nombre,
          tipoAreaSnapshot: area.tipo,
          resultadoMensualUtilizado: resultadoArea,
        });
      }
    }

    if (areasConResultado > 0) {
      promedioAreas = Number((sumaResultados / areasConResultado).toFixed(4));
    }
  }

  const kpiFinal = calcularKpiFinal(porcentajeCumplimiento, promedioAreas);

  return {
    usuario: {
      id: usuario.id,
      nombre: usuario.nombre,
      nombreUsuario: usuario.nombreUsuario,
      correo: usuario.correo,
      rol: usuario.rol,
      seEvalua: usuario.seEvalua,
      esComodin: usuario.esComodin,
    },
    usuarioId,
    anio,
    mes,
    seEvaluaSnapshot,
    auditoriasEsperadas,
    auditoriasATiempo,
    porcentajeCumplimiento,
    promedioAreas,
    areasConResultado,
    kpiFinal,
    calculadoEn: ahora,
    detallesAreas: detallesAreasParaGuardar,
  };
};

/**
 * Calcula y materializa el cumplimiento y KPI 50/50 de un usuario para un mes dado.
 * Protege snapshots históricos de áreas ya liquidadas si existen.
 */
export const calcularYGuardarCumplimientoUsuario = async (
  tx: PrismaTransaction | typeof prisma,
  usuarioId: number,
  anio: number,
  mes: number,
  forzarRecalculoAreas = false,
  ahora = new Date(),
) => {
  const calculo = await calcularCumplimientoUsuarioEnMemoria(tx, usuarioId, anio, mes, forzarRecalculoAreas, ahora);

  // Materialización atómica en la base de datos
  const materializado = await tx.cumplimientoMensualUsuario.upsert({
    where: {
      usuarioId_anio_mes: {
        usuarioId,
        anio,
        mes,
      },
    },
    update: {
      seEvaluaSnapshot: calculo.seEvaluaSnapshot,
      auditoriasEsperadas: calculo.auditoriasEsperadas,
      auditoriasATiempo: calculo.auditoriasATiempo,
      porcentajeCumplimiento: calculo.porcentajeCumplimiento !== null ? new Prisma.Decimal(calculo.porcentajeCumplimiento) : null,
      promedioAreas: calculo.promedioAreas !== null ? new Prisma.Decimal(calculo.promedioAreas) : null,
      areasConResultado: calculo.areasConResultado,
      kpiFinal: calculo.kpiFinal !== null ? new Prisma.Decimal(calculo.kpiFinal) : null,
      calculadoEn: new Date(),
    },
    create: {
      usuarioId,
      anio,
      mes,
      seEvaluaSnapshot: calculo.seEvaluaSnapshot,
      auditoriasEsperadas: calculo.auditoriasEsperadas,
      auditoriasATiempo: calculo.auditoriasATiempo,
      porcentajeCumplimiento: calculo.porcentajeCumplimiento !== null ? new Prisma.Decimal(calculo.porcentajeCumplimiento) : null,
      promedioAreas: calculo.promedioAreas !== null ? new Prisma.Decimal(calculo.promedioAreas) : null,
      areasConResultado: calculo.areasConResultado,
      kpiFinal: calculo.kpiFinal !== null ? new Prisma.Decimal(calculo.kpiFinal) : null,
      calculadoEn: new Date(),
    },
  });

  // Reemplazar detalles congelados de áreas
  await tx.cumplimientoMensualArea.deleteMany({
    where: { cumplimientoMensualUsuarioId: materializado.id },
  });

  if (calculo.detallesAreas.length > 0) {
    await tx.cumplimientoMensualArea.createMany({
      data: calculo.detallesAreas.map((det) => ({
        cumplimientoMensualUsuarioId: materializado.id,
        areaId: det.areaId,
        codigoAreaSnapshot: det.codigoAreaSnapshot,
        nombreAreaSnapshot: det.nombreAreaSnapshot,
        tipoAreaSnapshot: det.tipoAreaSnapshot,
        resultadoMensualUtilizado: new Prisma.Decimal(det.resultadoMensualUtilizado),
      })),
    });
  }

  return {
    ...materializado,
    porcentajeCumplimiento: calculo.porcentajeCumplimiento,
    promedioAreas: calculo.promedioAreas,
    kpiFinal: calculo.kpiFinal,
    detallesAreas: calculo.detallesAreas,
  };
};

/**
 * Liquida / recalcula el cumplimiento y KPI para todos los usuarios activos del sistema en un mes determinado.
 */
export const liquidarCumplimientosMensuales = async (
  tx: PrismaTransaction | typeof prisma,
  anio: number,
  mes: number,
) => {
  const usuarios = await tx.usuario.findMany({
    where: { activo: true },
    select: { id: true },
  });

  const resultados = [];
  for (const usuario of usuarios) {
    const res = await calcularYGuardarCumplimientoUsuario(tx, usuario.id, anio, mes, true);
    resultados.push(res);
  }
  return resultados;
};

/**
 * Obtiene la vista mensual operativa completa de cumplimientos (IDEMPOTENTE, solo lectura en GET):
 * - Si no existen registros materializados para el mes, liquida una vez inicial.
 * - Si ya existen registros, lee directamente sin mutar.
 * - Genera contratos compatibles 100% tanto con la estructura plana como anidada del frontend.
 */
export const obtenerVistaMensualCumplimientos = async (
  tx: PrismaTransaction | typeof prisma,
  anio: number,
  mes: number,
) => {
  const ahora = new Date();

  // 1. Cargar KPIs de los usuarios para el periodo
  const cumplimientosUsuarios = await tx.cumplimientoMensualUsuario.findMany({
    where: { anio, mes },
    include: {
      usuario: {
        select: {
          id: true,
          nombre: true,
          nombreUsuario: true,
          correo: true,
          rol: true,
          seEvalua: true,
          esComodin: true,
        },
      },
      detallesAreas: true,
    },
    orderBy: [
      { usuario: { nombre: 'asc' } },
    ],
  });

  let usuariosCalculados: Array<{
    usuario: {
      id: number;
      nombre: string;
      nombreUsuario: string;
      correo: string | null;
      rol: string;
      seEvalua: boolean;
      esComodin: boolean;
    };
    seEvaluaSnapshot: boolean;
    auditoriasEsperadas: number;
    auditoriasATiempo: number;
    porcentajeCumplimiento: number | Prisma.Decimal | null;
    promedioAreas: number | Prisma.Decimal | null;
    areasConResultado: number;
    kpiFinal: number | Prisma.Decimal | null;
    calculadoEn: Date;
    detallesAreas: Array<{
      areaId: number;
      codigoAreaSnapshot: string;
      nombreAreaSnapshot: string;
      tipoAreaSnapshot: TipoArea;
      resultadoMensualUtilizado: number | Prisma.Decimal;
    }>;
  }>;

  // Si existen registros materializados (mes liquidado/cerrado), se leen directamente.
  // Si no existen, se calculan en memoria SIN mutar la base de datos (lectura pura).
  if (cumplimientosUsuarios.length > 0) {
    usuariosCalculados = cumplimientosUsuarios;
  } else {
    const usuariosActivos = await tx.usuario.findMany({
      where: { activo: true },
      select: { id: true },
      orderBy: { nombre: 'asc' },
    });

    usuariosCalculados = await Promise.all(
      usuariosActivos.map((u) => calcularCumplimientoUsuarioEnMemoria(tx, u.id, anio, mes, false, ahora)),
    );
  }

  // 2. Cargar Asignaciones Mensuales y Objetivos del mes para la vista tabular operativa
  // Solo se consideran áreas activas para el seguimiento operativo vigente
  const asignacionesMensuales = await tx.asignacionMensual.findMany({
    where: {
      anio,
      mes,
      area: { activo: true },
    },
    include: {
      area: {
        include: {
          usuariosArea: {
            where: { area: { activo: true } },
            include: {
              usuario: {
                select: { id: true, nombre: true, nombreUsuario: true },
              },
            },
          },
        },
      },
      auditor: {
        select: { id: true, nombre: true, nombreUsuario: true, rol: true, esComodin: true },
      },
      responsableCumplimiento: {
        select: { id: true, nombre: true, nombreUsuario: true, rol: true },
      },
    },
  });

  const objetivosMes = await tx.objetivoAuditoria.findMany({
    where: {
      anio,
      mes,
      area: { activo: true },
    },
    include: {
      envioResultado: {
        include: {
          enviadoPorUsuario: {
            select: { id: true, nombre: true, nombreUsuario: true, rol: true, esComodin: true },
          },
        },
      },
      asignacionesAuditoria: {
        where: { estado: { not: EstadoAsignacionAuditoria.CANCELADA } },
        include: {
          auditor: {
            select: { id: true, nombre: true, nombreUsuario: true, rol: true, esComodin: true },
          },
          responsableCumplimiento: {
            select: { id: true, nombre: true, nombreUsuario: true, rol: true },
          },
        },
        orderBy: { creadoEn: 'desc' },
      },
    },
  });

  // Agrupar objetivos por areaId
  const objetivosPorArea = new Map<number, typeof objetivosMes>();
  for (const obj of objetivosMes) {
    const list = objetivosPorArea.get(obj.areaId) ?? [];
    list.push(obj);
    objetivosPorArea.set(obj.areaId, list);
  }

  // Construir filas operativas (soporta tanto contratos planos como anidados para frontend)
  const filasOperativas = asignacionesMensuales.map((asigMensual) => {
    const area = asigMensual.area;
    const objs = objetivosPorArea.get(area.id) ?? [];

    const objP1 = objs.find((o) => o.periodo === CORTE_P1);
    const objP2 = objs.find((o) => o.periodo === CORTE_P2);

    const asigP1 = objP1?.asignacionesAuditoria[0] ?? null;
    const asigP2 = objP2?.asignacionesAuditoria[0] ?? null;

    const envioP1 = objP1?.envioResultado ?? null;
    const envioP2 = objP2?.envioResultado ?? null;

    const chipP1 = objP1
      ? (objP1.canceladoEn ? 'NO_APLICA' : determinarEstadoChip(objP1, envioP1, ahora, asigP1?.reabiertaHasta ?? null))
      : 'NO_APLICA';
    const chipP2 = objP2
      ? (objP2.canceladoEn ? 'NO_APLICA' : determinarEstadoChip(objP2, envioP2, ahora, asigP2?.reabiertaHasta ?? null))
      : 'NO_APLICA';

    // Resolver ejecutores reales e intervenciones comodín
    const ejecutorP1 = envioP1
      ? {
          id: envioP1.enviadoPorUsuario?.id ?? null,
          nombre: envioP1.enviadoPorUsuario?.nombre ?? envioP1.nombreAuditorSnapshot,
          esComodin: Boolean(envioP1.enviadoPorUsuario?.esComodin && envioP1.enviadoPorUsuarioId !== asigP1?.auditorId),
        }
      : null;

    const ejecutorP2 = envioP2
      ? {
          id: envioP2.enviadoPorUsuario?.id ?? null,
          nombre: envioP2.enviadoPorUsuario?.nombre ?? envioP2.nombreAuditorSnapshot,
          esComodin: Boolean(envioP2.enviadoPorUsuario?.esComodin && envioP2.enviadoPorUsuarioId !== asigP2?.auditorId),
        }
      : null;

    const auditorAsignado = asigMensual.auditor;
    const responsableBase = asigMensual.responsableCumplimiento ?? auditorAsignado;
    const esDelegada = Boolean(responsableBase && auditorAsignado && responsableBase.id !== auditorAsignado.id);
    const responsable = responsableBase ? { ...responsableBase, esDelegado: esDelegada } : null;

    const p1Porcentaje = envioP1 && !envioP1.invalidadoEn ? Number(envioP1.porcentaje) : null;
    const p2Porcentaje = envioP2 && !envioP2.invalidadoEn ? Number(envioP2.porcentaje) : null;

    const calificacionAreaMes = calcularResultadoMensualCanonico(p1Porcentaje, p2Porcentaje, chipP1, chipP2);

    const propietarios = area.usuariosArea.map((ua) => ({
      id: ua.usuario.id,
      nombre: ua.usuario.nombre,
      nombreUsuario: ua.usuario.nombreUsuario,
    }));

    return {
      // Propiedades planas para máxima compatibilidad con frontend
      areaId: area.id,
      codigoArea: area.codigo,
      nombreArea: area.nombre,
      tipoArea: area.tipo,
      activo: area.activo,
      activa: area.activo,
      propietarios,
      resultadoMensual: calificacionAreaMes,
      calificacionAreaMes,
      // Propiedades anidadas originales
      area: {
        id: area.id,
        codigo: area.codigo,
        nombre: area.nombre,
        tipo: area.tipo,
        activo: area.activo,
        propietarios,
      },
      auditorAsignado,
      responsableCumplimiento: responsable,
      esDelegada,
      p1: {
        objetivoId: objP1?.id ?? null,
        terminaEn: objP1?.terminaEn ?? null,
        chip: chipP1,
        estadoChip: chipP1,
        porcentaje: p1Porcentaje,
        calificacion: p1Porcentaje,
        ejecutorReal: ejecutorP1,
        ejecutadoPor: ejecutorP1,
        esComodin: Boolean(ejecutorP1?.esComodin),
      },
      p2: {
        objetivoId: objP2?.id ?? null,
        terminaEn: objP2?.terminaEn ?? null,
        chip: chipP2,
        estadoChip: chipP2,
        porcentaje: p2Porcentaje,
        calificacion: p2Porcentaje,
        ejecutorReal: ejecutorP2,
        ejecutadoPor: ejecutorP2,
        esComodin: Boolean(ejecutorP2?.esComodin),
      },
    };
  }).sort((a, b) => a.nombreArea.localeCompare(b.nombreArea, 'es'));

  // Formatear resumen de usuarios (proporciona campos planos y anidados de usuario)
  const usuariosKpi = usuariosCalculados
    .filter((c) => c.seEvaluaSnapshot || c.auditoriasEsperadas > 0)
    .map((c) => ({
      usuarioId: c.usuario.id,
      nombre: c.usuario.nombre,
      nombreUsuario: c.usuario.nombreUsuario,
      correo: c.usuario.correo,
      rol: c.usuario.rol,
      usuario: c.usuario,
      seEvalua: c.seEvaluaSnapshot,
      auditoriasEsperadas: c.auditoriasEsperadas,
      auditoriasATiempo: c.auditoriasATiempo,
      porcentajeCumplimiento: c.porcentajeCumplimiento !== null ? Number(c.porcentajeCumplimiento) : null,
      promedioAreas: c.promedioAreas !== null ? Number(c.promedioAreas) : null,
      areasConResultado: c.areasConResultado,
      kpiFinal: c.kpiFinal !== null ? Number(c.kpiFinal) : null,
      calculadoEn: c.calculadoEn,
      detallesAreas: c.detallesAreas.map((d) => ({
        areaId: d.areaId,
        codigo: d.codigoAreaSnapshot,
        nombre: d.nombreAreaSnapshot,
        tipo: d.tipoAreaSnapshot,
        resultado: Number(d.resultadoMensualUtilizado),
      })),
    }));

  return {
    anio,
    mes,
    filas: filasOperativas,
    filasOperativas,
    usuariosKpi,
  };
};
