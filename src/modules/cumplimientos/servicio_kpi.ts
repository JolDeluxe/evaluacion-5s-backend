import type { PrismaTransaction } from '../../db';
import { prisma } from '../../db';
import { Prisma } from '../../generated/prisma/client';
import { EstadoAsignacionAuditoria, TipoArea } from '../../generated/prisma/enums';
import { calcularCierreConGracia } from '../../utils/periodos';

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

export type EstadoChipCumplimiento = 'A_TIEMPO' | 'TARDE' | 'NO_REALIZADA' | 'PENDIENTE';

export function determinarEstadoChip(
  objetivo: { terminaEn: Date; envioResultadoId: number | null },
  envioResultado: { realizadaATiempo: boolean; invalidadoEn: Date | null } | null,
  ahora = new Date(),
  reabiertaHasta: Date | null = null,
): EstadoChipCumplimiento {
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
) => {
  const usuario = await tx.usuario.findUniqueOrThrow({
    where: { id: usuarioId },
    include: {
      areasUsuario: {
        include: {
          area: {
            select: { id: true, codigo: true, nombre: true, tipo: true },
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
  const asignacionesResponsable = await tx.asignacionAuditoria.findMany({
    where: {
      estado: { not: EstadoAsignacionAuditoria.CANCELADA },
      objetivoAuditoria: {
        anio,
        mes,
        canceladoEn: null,
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
          canceladoEn: null,
        },
        include: {
          envioResultado: {
            select: { id: true, porcentaje: true, invalidadoEn: true },
          },
        },
      });

      const p1 = objetivosArea.find((o) => o.periodo === CORTE_P1);
      const p2 = objetivosArea.find((o) => o.periodo === CORTE_P2);

      const envioP1 = p1?.envioResultado && !p1.envioResultado.invalidadoEn ? p1.envioResultado : null;
      const envioP2 = p2?.envioResultado && !p2.envioResultado.invalidadoEn ? p2.envioResultado : null;

      const p1Score = envioP1 ? Number(envioP1.porcentaje) : null;
      const p2Score = envioP2 ? Number(envioP2.porcentaje) : null;

      let resultadoArea: number | null = null;
      if (p1Score !== null && p2Score !== null) {
        resultadoArea = Number(((p1Score + p2Score) / 2).toFixed(4));
      } else if (p1Score !== null) {
        resultadoArea = Number(p1Score.toFixed(4));
      } else if (p2Score !== null) {
        resultadoArea = Number(p2Score.toFixed(4));
      }

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
      seEvaluaSnapshot,
      auditoriasEsperadas,
      auditoriasATiempo,
      porcentajeCumplimiento: porcentajeCumplimiento !== null ? new Prisma.Decimal(porcentajeCumplimiento) : null,
      promedioAreas: promedioAreas !== null ? new Prisma.Decimal(promedioAreas) : null,
      areasConResultado,
      kpiFinal: kpiFinal !== null ? new Prisma.Decimal(kpiFinal) : null,
      calculadoEn: new Date(),
    },
    create: {
      usuarioId,
      anio,
      mes,
      seEvaluaSnapshot,
      auditoriasEsperadas,
      auditoriasATiempo,
      porcentajeCumplimiento: porcentajeCumplimiento !== null ? new Prisma.Decimal(porcentajeCumplimiento) : null,
      promedioAreas: promedioAreas !== null ? new Prisma.Decimal(promedioAreas) : null,
      areasConResultado,
      kpiFinal: kpiFinal !== null ? new Prisma.Decimal(kpiFinal) : null,
      calculadoEn: new Date(),
    },
  });

  // Reemplazar detalles congelados de áreas
  await tx.cumplimientoMensualArea.deleteMany({
    where: { cumplimientoMensualUsuarioId: materializado.id },
  });

  if (detallesAreasParaGuardar.length > 0) {
    await tx.cumplimientoMensualArea.createMany({
      data: detallesAreasParaGuardar.map((det) => ({
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
    porcentajeCumplimiento,
    promedioAreas,
    kpiFinal,
    detallesAreas: detallesAreasParaGuardar,
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
  let cumplimientosUsuarios = await tx.cumplimientoMensualUsuario.findMany({
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

  // Si no hay ningún cumplimiento liquidado aún para este mes, liquidar por primera vez
  if (cumplimientosUsuarios.length === 0) {
    await liquidarCumplimientosMensuales(tx, anio, mes);
    cumplimientosUsuarios = await tx.cumplimientoMensualUsuario.findMany({
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
  }

  // 2. Cargar Asignaciones Mensuales y Objetivos del mes para la vista tabular operativa
  const asignacionesMensuales = await tx.asignacionMensual.findMany({
    where: { anio, mes },
    include: {
      area: {
        include: {
          usuariosArea: {
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
    where: { anio, mes, canceladoEn: null },
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

    const chipP1 = objP1 ? determinarEstadoChip(objP1, envioP1, ahora, asigP1?.reabiertaHasta ?? null) : 'PENDIENTE';
    const chipP2 = objP2 ? determinarEstadoChip(objP2, envioP2, ahora, asigP2?.reabiertaHasta ?? null) : 'PENDIENTE';

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

    let calificacionAreaMes: number | null = null;
    if (p1Porcentaje !== null && p2Porcentaje !== null) {
      calificacionAreaMes = Number(((p1Porcentaje + p2Porcentaje) / 2).toFixed(2));
    } else if (p1Porcentaje !== null) {
      calificacionAreaMes = Number(p1Porcentaje.toFixed(2));
    } else if (p2Porcentaje !== null) {
      calificacionAreaMes = Number(p2Porcentaje.toFixed(2));
    }

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
      propietarios,
      resultadoMensual: calificacionAreaMes,
      calificacionAreaMes,
      // Propiedades anidadas originales
      area: {
        id: area.id,
        codigo: area.codigo,
        nombre: area.nombre,
        tipo: area.tipo,
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
  const usuariosKpi = cumplimientosUsuarios
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
