import type { PrismaTransaction } from '../../db';
import {
  AlcanceFormulario,
  EstadoAsignacionAuditoria,
  RolUsuario,
  TipoArea,
} from '../../generated/prisma/enums';
import { conflicto, solicitudInvalida } from '../../utils/errores';
import { calcularCierreConGracia, construirDetalleAdminPeriodo } from '../../utils/periodos';
import { registrarAuditoria } from '../registros_auditoria/helper';
import { validarAuditorAsignable } from './helper';
export const CORTE_P1 = 1;
export const CORTE_P2 = 2;

const rolesAuditores = [RolUsuario.AUDITOR, RolUsuario.ADMINISTRADOR];

const inicioDia = (anio: number, mes: number, dia: number) => new Date(anio, mes - 1, dia, 0, 0, 0, 0);
const finDia = (anio: number, mes: number, dia: number) => new Date(anio, mes - 1, dia, 23, 59, 59, 999);
const ultimoDiaMes = (anio: number, mes: number) => mes === 2 ? 28 : new Date(anio, mes, 0).getDate();

export const inicioMes = (anio: number, mes: number) => inicioDia(anio, mes, 1);

export const inicioMesSiguiente = (fecha = new Date()) => (
  new Date(fecha.getFullYear(), fecha.getMonth() + 1, 1, 0, 0, 0, 0)
);

export const periodoMensual = (anio: number, mes: number, numeroCorte: number) => {
  if (numeroCorte === CORTE_P1) {
    return {
      numeroCorte,
      periodo: numeroCorte,
      iniciaEn: inicioDia(anio, mes, 1),
      terminaEn: finDia(anio, mes, 15),
      etiqueta: 'P1',
    };
  }
  return {
    numeroCorte,
    periodo: numeroCorte,
    iniciaEn: inicioDia(anio, mes, 16),
    terminaEn: finDia(anio, mes, ultimoDiaMes(anio, mes)),
    etiqueta: 'P2',
  };
};

const alcancesPorTipo = (tipo: TipoArea) => (
  tipo === TipoArea.ADMINISTRATIVA
    ? [AlcanceFormulario.ADMINISTRATIVO, AlcanceFormulario.AMBOS]
    : [AlcanceFormulario.OPERATIVO, AlcanceFormulario.AMBOS]
);

const obtenerVersionFormularioParaTipo = async (tx: PrismaTransaction, tipoArea: TipoArea) => {
  const versiones = await tx.versionFormulario.findMany({
    where: {
      activa: true,
      formulario: {
        activo: true,
        alcance: { in: alcancesPorTipo(tipoArea) },
      },
    },
    include: { formulario: true },
    orderBy: { actualizadoEn: 'desc' },
  });
  const exacta = versiones.find((version) => (
    (tipoArea === TipoArea.ADMINISTRATIVA && version.formulario.alcance === AlcanceFormulario.ADMINISTRATIVO)
    || (tipoArea === TipoArea.OPERATIVA && version.formulario.alcance === AlcanceFormulario.OPERATIVO)
  ));
  return exacta ?? versiones[0] ?? null;
};

const serialFechaUtc = (fecha: Date) => (
  fecha.getUTCFullYear() * 10000 + (fecha.getUTCMonth() + 1) * 100 + fecha.getUTCDate()
);

const serialFechaPeriodo = (anio: number, mes: number, dia: number) => anio * 10000 + mes * 100 + dia;

const areaAuditableEnPeriodo = (
  area: { activo: boolean; auditableDesde: Date | null },
  anio: number,
  mes: number,
  diaTermino: number,
) => (
  area.activo && (!area.auditableDesde || serialFechaUtc(area.auditableDesde) <= serialFechaPeriodo(anio, mes, diaTermino))
);

export const asegurarProgramacionMensual = async (
  tx: PrismaTransaction,
  anio: number,
  mes: number,
  creadoPorId: number,
) => {
  const versionesPorTipo = new Map<TipoArea, number>();
  for (const tipo of [TipoArea.ADMINISTRATIVA, TipoArea.OPERATIVA]) {
    const version = await obtenerVersionFormularioParaTipo(tx, tipo);
    if (!version) throw conflicto(`No existe formulario activo para areas ${tipo.toLowerCase()}`);
    versionesPorTipo.set(tipo, version.id);
  }

  const areas = await tx.area.findMany({
    select: { id: true, codigo: true, nombre: true, tipo: true, activo: true, auditableDesde: true, auditableHasta: true },
  });

  void creadoPorId;
  for (const numeroCorte of [CORTE_P1, CORTE_P2]) {
    const periodo = periodoMensual(anio, mes, numeroCorte);
    for (const area of areas.filter((actual) => areaAuditableEnPeriodo(actual, anio, mes, numeroCorte === CORTE_P1 ? 15 : ultimoDiaMes(anio, mes)))) {
      await tx.objetivoAuditoria.upsert({
        where: { areaId_anio_mes_periodo: { areaId: area.id, anio, mes, periodo: periodo.periodo } },
        update: {},
        create: {
          areaId: area.id,
          anio,
          mes,
          periodo: periodo.periodo,
          versionFormularioId: versionesPorTipo.get(area.tipo) ?? 0,
          iniciaEn: periodo.iniciaEn,
          terminaEn: periodo.terminaEn,
          codigoAreaSnapshot: area.codigo,
          nombreAreaSnapshot: area.nombre,
          tipoAreaSnapshot: area.tipo,
        },
      });
    }
  }
};

const cargarObjetivosMes = async (tx: PrismaTransaction, anio: number, mes: number) => (
  tx.objetivoAuditoria.findMany({
    where: { anio, mes, periodo: { in: [CORTE_P1, CORTE_P2] } },
    include: {
      area: { include: { usuariosArea: { select: { usuarioId: true } } } },
      envioResultado: true,
      enviosAuditoria: true,
      asignacionesAuditoria: {
        include: {
          auditor: { select: { id: true, nombre: true, nombreUsuario: true, rol: true } },
          asignacionMensual: {
            include: { auditor: { select: { id: true, nombre: true, nombreUsuario: true, rol: true } } },
          },
        },
        orderBy: [{ estado: 'asc' }, { actualizadoEn: 'desc' }],
      },
    },
    orderBy: [
      { area: { nombre: 'asc' } },
      { periodo: 'asc' },
    ],
  })
);

const cargarAsignacionesMensualesMes = async (tx: PrismaTransaction, anio: number, mes: number) => (
  tx.asignacionMensual.findMany({
    where: { anio, mes },
    include: { auditor: { select: { id: true, nombre: true, nombreUsuario: true, rol: true } } },
  })
);

type PeriodoObjetivo = Awaited<ReturnType<typeof cargarObjetivosMes>>[number];
type AsignacionMensualMes = Awaited<ReturnType<typeof cargarAsignacionesMensualesMes>>[number];

const asignacionVigente = <T extends { estado: EstadoAsignacionAuditoria }>(asignaciones: T[]) => (
  asignaciones.find((asignacion) => asignacion.estado !== EstadoAsignacionAuditoria.CANCELADA) ?? null
);

const mapearUsuario = (usuario: { id: number; nombre: string; nombreUsuario: string; rol?: RolUsuario }) => ({
  id: usuario.id,
  nombre: usuario.nombre,
  nombreUsuario: usuario.nombreUsuario,
  rol: usuario.rol,
});

const construirPeriodoFila = (
  objetivo: PeriodoObjetivo | undefined,
  auditorMensualId: number | null,
) => {
  if (!objetivo) return { programada: false };
  const asignacion = asignacionVigente(objetivo.asignacionesAuditoria);
  const detalle = construirDetalleAdminPeriodo(objetivo, new Date(), asignacion?.reabiertaHasta ?? null);
  const auditor = asignacion?.auditor ? mapearUsuario(asignacion.auditor) : null;
  const realizada = detalle.realizada || asignacion?.estado === EstadoAsignacionAuditoria.COMPLETADA;
  const vencida = asignacion?.estado === EstadoAsignacionAuditoria.VENCIDA || detalle.situacion === 'NO_REALIZADA';
  return {
    programada: true,
    objetivoAuditoriaId: objetivo.id,
    asignacionId: asignacion?.id ?? null,
    auditorEfectivo: auditor,
    usaAuditorMensual: Boolean(auditor && auditorMensualId && auditor.id === auditorMensualId),
    estadoAsignacion: asignacion?.estado ?? null,
    estadoAuditoria: detalle.situacion,
    realizada,
    vencida,
    bloqueada: realizada || vencida,
    motivoExcepcion: asignacion?.motivoExcepcion ?? null,
    reabiertaHasta: asignacion?.reabiertaHasta ?? null,
    cierreGracia: detalle.cierreGracia,
  };
};

const construirFilasMensuales = (objetivos: PeriodoObjetivo[], asignacionesMensuales: AsignacionMensualMes[] = []) => {
  const porArea = new Map<number, PeriodoObjetivo[]>();
  const mensualPorArea = new Map(asignacionesMensuales.map((asignacion) => [asignacion.areaId, asignacion]));
  for (const objetivo of objetivos) {
    const lista = porArea.get(objetivo.areaId) ?? [];
    lista.push(objetivo);
    porArea.set(objetivo.areaId, lista);
  }

  return [...porArea.values()].map((objetivosArea) => {
    const p1Objetivo = objetivosArea.find((objetivo) => objetivo.periodo === CORTE_P1);
    const p2Objetivo = objetivosArea.find((objetivo) => objetivo.periodo === CORTE_P2);
    const areaBase = (p1Objetivo ?? p2Objetivo)?.area;
    const asignacionMensual = areaBase ? mensualPorArea.get(areaBase.id) : null;
    const p1Asignacion = p1Objetivo ? asignacionVigente(p1Objetivo.asignacionesAuditoria) : null;
    const p2Asignacion = p2Objetivo ? asignacionVigente(p2Objetivo.asignacionesAuditoria) : null;
    const auditorMensual = asignacionMensual?.auditor ?? p1Asignacion?.asignacionMensual?.auditor ?? p2Asignacion?.asignacionMensual?.auditor ?? p1Asignacion?.auditor ?? p2Asignacion?.auditor ?? null;
    const auditorMensualId = auditorMensual?.id ?? null;
    const p1 = construirPeriodoFila(p1Objetivo, auditorMensualId);
    const p2 = construirPeriodoFila(p2Objetivo, auditorMensualId);
    const periodosProgramados = [p1, p2].filter((periodo) => periodo.programada);
    const todosAsignados = periodosProgramados.length > 0 && periodosProgramados.every((periodo) => Boolean(periodo.auditorEfectivo));
    const tieneExcepcion = periodosProgramados.some((periodo) => periodo.auditorEfectivo && !periodo.usaAuditorMensual);

    return {
      area: {
        id: areaBase?.id ?? 0,
        codigo: areaBase?.codigo ?? '',
        nombre: areaBase?.nombre ?? '',
        tipo: areaBase?.tipo ?? '',
        responsablesIds: areaBase?.usuariosArea.map((usuarioArea) => usuarioArea.usuarioId) ?? [],
      },
      auditorMensual: auditorMensual ? mapearUsuario(auditorMensual) : null,
      estado: todosAsignados ? 'ASIGNADO' as const : 'SIN_AUDITOR' as const,
      tieneExcepcion,
      periodos: { p1, p2 },
    };
  }).sort((a, b) => a.area.nombre.localeCompare(b.area.nombre, 'es'));
};

const filtrarFilas = (
  filas: ReturnType<typeof construirFilasMensuales>,
  filtros: { busqueda?: string; estado?: 'ASIGNADO' | 'SIN_AUDITOR'; auditorId?: number },
) => {
  const busqueda = filtros.busqueda?.trim().toLowerCase();
  return filas.filter((fila) => {
    const auditores = [fila.auditorMensual, fila.periodos.p1.auditorEfectivo, fila.periodos.p2.auditorEfectivo].filter(Boolean);
    if (filtros.estado && fila.estado !== filtros.estado) return false;
    if (filtros.auditorId && !auditores.some((auditor) => auditor?.id === filtros.auditorId)) return false;
    if (!busqueda) return true;
    return [
      fila.area.codigo,
      fila.area.nombre,
      ...auditores.map((auditor) => `${auditor?.nombre} ${auditor?.nombreUsuario}`),
    ].some((valor) => valor.toLowerCase().includes(busqueda));
  });
};

export const obtenerAuditoresDisponibles = async (tx: PrismaTransaction) => (
  tx.usuario.findMany({
    where: { activo: true, rol: { in: rolesAuditores } },
    select: { id: true, nombre: true, nombreUsuario: true, rol: true },
    orderBy: { nombre: 'asc' },
  })
);

const calcularCarga = (filas: ReturnType<typeof construirFilasMensuales>, auditores: Awaited<ReturnType<typeof obtenerAuditoresDisponibles>>) => {
  const conteos = new Map(auditores.map((auditor) => [auditor.id, 0]));
  for (const fila of filas) {
    if (!fila.auditorMensual) continue;
    conteos.set(fila.auditorMensual.id, (conteos.get(fila.auditorMensual.id) ?? 0) + 1);
  }
  return auditores.map((auditor) => ({
    ...mapearUsuario(auditor),
    areasAsignadas: conteos.get(auditor.id) ?? 0,
  }));
};

export const obtenerVistaMensual = async (
  tx: PrismaTransaction,
  anio: number,
  mes: number,
  filtros: { busqueda?: string; estado?: 'ASIGNADO' | 'SIN_AUDITOR'; auditorId?: number } = {},
) => {
  const [objetivos, auditores] = await Promise.all([
    cargarObjetivosMes(tx, anio, mes),
    obtenerAuditoresDisponibles(tx),
  ]);
  const asignacionesMensuales = await cargarAsignacionesMensualesMes(tx, anio, mes);
  const filas = construirFilasMensuales(objetivos, asignacionesMensuales);
  const filasFiltradas = filtrarFilas(filas, filtros);
  const resumen = {
    areas: filas.length,
    asignadas: filas.filter((fila) => fila.estado === 'ASIGNADO').length,
    sinAuditor: filas.filter((fila) => fila.estado === 'SIN_AUDITOR').length,
  };
  return {
    anio,
    mes,
    resumen,
    auditores: calcularCarga(filas, auditores),
    filas: filasFiltradas,
  };
};

const obtenerObjetivosAreaMes = async (tx: PrismaTransaction, areaId: number, anio: number, mes: number) => (
  tx.objetivoAuditoria.findMany({
    where: { areaId, anio, mes, periodo: { in: [CORTE_P1, CORTE_P2] } },
    include: {
      envioResultado: true,
      enviosAuditoria: true,
      asignacionesAuditoria: { orderBy: { actualizadoEn: 'desc' } },
    },
  })
);

const aplicarAsignacionPeriodo = async (
  tx: PrismaTransaction,
  objetivo: Awaited<ReturnType<typeof obtenerObjetivosAreaMes>>[number],
  auditorId: number,
  asignacionMensualId: number,
  asignadoPorId: number,
) => {
  const asignacion = asignacionVigente(objetivo.asignacionesAuditoria);
  const detalle = construirDetalleAdminPeriodo(objetivo, new Date(), asignacion?.reabiertaHasta ?? null);
  const estaRealizada = detalle.realizada || asignacion?.estado === EstadoAsignacionAuditoria.COMPLETADA || Boolean(asignacion?.completadoEn);
  const estaVencida = asignacion?.estado === EstadoAsignacionAuditoria.VENCIDA || detalle.situacion === 'NO_REALIZADA';

  if ((estaRealizada || estaVencida) && asignacion?.auditorId !== auditorId) {
    throw conflicto(`El periodo ${objetivo.periodo} no permite cambiar auditor`);
  }

  await validarAuditorAsignable(tx, auditorId, objetivo.id);
  const venceEn = calcularCierreConGracia(objetivo.terminaEn);
  const datosAsignacion = {
    asignacionMensualId,
    auditorId,
    asignadoPorId,
    estado: EstadoAsignacionAuditoria.PENDIENTE,
    asignadoEn: new Date(),
    venceEn,
    motivoExcepcion: null,
  };

  if (!asignacion) {
    const creada = await tx.asignacionAuditoria.create({
      data: { objetivoAuditoriaId: objetivo.id, ...datosAsignacion },
    });
    await registrarAuditoria({
      usuarioId: asignadoPorId,
      accion: 'CREAR_ASIGNACION_MENSUAL',
      tipoEntidad: 'AsignacionAuditoria',
      idEntidad: creada.id,
      datosNuevos: creada,
    }, tx);
    return creada;
  }

  if (asignacion.auditorId === auditorId) {
    return tx.asignacionAuditoria.update({
      where: { id: asignacion.id },
      data: { asignacionMensualId, motivoExcepcion: null, venceEn },
    });
  }

  await tx.asignacionAuditoria.update({
    where: { id: asignacion.id },
    data: {
      estado: EstadoAsignacionAuditoria.CANCELADA,
      canceladoEn: new Date(),
      motivoCancelacion: 'Cambio de asignacion mensual',
    },
  });

  const creada = await tx.asignacionAuditoria.create({
    data: { objetivoAuditoriaId: objetivo.id, ...datosAsignacion },
  });
  await registrarAuditoria({
    usuarioId: asignadoPorId,
    accion: 'CAMBIAR_ASIGNACION_MENSUAL',
    tipoEntidad: 'AsignacionAuditoria',
    idEntidad: creada.id,
    datosAnteriores: asignacion,
    datosNuevos: creada,
  }, tx);
  return creada;
};

export const guardarAsignacionMensual = async (
  tx: PrismaTransaction,
  params: {
    areaId: number;
    anio: number;
    mes: number;
    auditorMensualId: number;
    asignadoPorId: number;
    soloSiSinAuditor?: boolean;
  },
) => {
  const objetivos = await obtenerObjetivosAreaMes(tx, params.areaId, params.anio, params.mes);
  if (!objetivos.length) throw conflicto('El area no esta programada para este mes');
  if (params.soloSiSinAuditor && objetivos.some((objetivo) => asignacionVigente(objetivo.asignacionesAuditoria))) {
    return { actualizadas: 0, omitida: true };
  }

  const asignacionMensual = await tx.asignacionMensual.upsert({
    where: { areaId_anio_mes: { areaId: params.areaId, anio: params.anio, mes: params.mes } },
    update: {
      auditorId: params.auditorMensualId,
      asignadoPorId: params.asignadoPorId,
      asignadoEn: new Date(),
    },
    create: {
      areaId: params.areaId,
      anio: params.anio,
      mes: params.mes,
      auditorId: params.auditorMensualId,
      asignadoPorId: params.asignadoPorId,
      asignadoEn: new Date(),
    },
  });

  let actualizadas = 0;
  for (const objetivo of objetivos) {
    await aplicarAsignacionPeriodo(
      tx,
      objetivo,
      params.auditorMensualId,
      asignacionMensual.id,
      params.asignadoPorId,
    );
    actualizadas += 1;
  }

  return { actualizadas, omitida: false };
};

const mesAnterior = (anio: number, mes: number) => (
  mes === 1 ? { anio: anio - 1, mes: 12 } : { anio, mes: mes - 1 }
);

export const autoasignarPendientes = async (
  tx: PrismaTransaction,
  anio: number,
  mes: number,
  asignadoPorId: number,
) => {
  const [vistaActual, vistaAnterior] = await Promise.all([
    obtenerVistaMensual(tx, anio, mes),
    obtenerVistaMensual(tx, mesAnterior(anio, mes).anio, mesAnterior(anio, mes).mes),
  ]);
  const auditores = await obtenerAuditoresDisponibles(tx);
  const cargas = new Map(vistaActual.auditores.map((auditor) => [auditor.id, auditor.areasAsignadas]));
  const anteriorPorArea = new Map(vistaAnterior.filas.map((fila) => [fila.area.id, fila.auditorMensual?.id ?? null]));
  let asignadas = 0;
  let sinCandidato = 0;
  let omitidasPorConcurrencia = 0;

  for (const fila of vistaActual.filas.filter((actual) => actual.estado === 'SIN_AUDITOR')) {
    const responsables = new Set(fila.area.responsablesIds);
    const elegibles = auditores.filter((auditor) => !responsables.has(auditor.id));
    if (!elegibles.length) {
      sinCandidato += 1;
      continue;
    }
    const auditorAnteriorId = anteriorPorArea.get(fila.area.id);
    const preferidos = elegibles.filter((auditor) => auditor.id !== auditorAnteriorId);
    const bolsa = preferidos.length ? preferidos : elegibles;
    const elegido = [...bolsa].sort((a, b) => (
      (cargas.get(a.id) ?? 0) - (cargas.get(b.id) ?? 0)
      || a.nombre.localeCompare(b.nombre, 'es')
      || a.id - b.id
    ))[0];
    const resultado = await guardarAsignacionMensual(tx, {
      areaId: fila.area.id,
      anio,
      mes,
      auditorMensualId: elegido.id,
      asignadoPorId,
      soloSiSinAuditor: true,
    });
    if (resultado.omitida) {
      omitidasPorConcurrencia += 1;
      continue;
    }
    asignadas += 1;
    cargas.set(elegido.id, (cargas.get(elegido.id) ?? 0) + 1);
  }

  return { asignadas, sinCandidato, omitidasPorConcurrencia };
};

export const auditableDesdeParaInicio = (inicio: 'ESTE_MES' | 'PROXIMO_MES', ahora = new Date()) => {
  if (inicio === 'PROXIMO_MES') return inicioMesSiguiente(ahora);
  return new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate(), 0, 0, 0, 0);
};

export const validarAuditorMensualArea = async (tx: PrismaTransaction, areaId: number, auditorId: number) => {
  const usuarioArea = await tx.usuarioArea.findFirst({ where: { areaId, usuarioId: auditorId }, select: { id: true } });
  if (usuarioArea) throw solicitudInvalida('El auditor no puede auditar su propia area');
};
