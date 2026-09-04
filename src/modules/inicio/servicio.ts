import type { PrismaTransaction } from '../../db';
import { EstadoAsignacionAuditoria, RolUsuario } from '../../generated/prisma/enums';
import { puedeAdministrar5S } from '../../utils/permisos';
import { derivarSituacionObjetivo, objetivoEsRealizable, SituacionObjetivo, calcularCierreConGracia } from '../../utils/periodos';
import { obtenerEjecutablesUsuario } from '../asignaciones/01_listar';
import { asegurarProgramacionMensual, obtenerVistaMensual, puedeAsegurarProgramacionMensual, periodoMensual } from '../asignaciones/programacion_mensual';
import { obtenerResultadosAreas } from '../resultados/servicio';

const MESES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

const calcularMesAnterior = (anio: number, mes: number) => {
  if (mes === 1) return { anio: anio - 1, mes: 12, clave: `${anio - 1}-12` };
  const m = mes - 1;
  return { anio, mes: m, clave: `${anio}-${String(m).padStart(2, '0')}` };
};

export const obtenerDashboardInicio = async (
  tx: PrismaTransaction,
  autenticacion: { usuarioId: number; rol: RolUsuario },
) => {
  const ahora = new Date();
  const anioActual = ahora.getFullYear();
  const mesActual = ahora.getMonth() + 1;

  const esAdmin = puedeAdministrar5S(autenticacion.rol);

  // 1. Asegurar programación del mes actual si aplica
  if (puedeAsegurarProgramacionMensual(anioActual, mesActual, ahora)) {
    await asegurarProgramacionMensual(tx, anioActual, mesActual, autenticacion.usuarioId);
  }

  // 2. Cargar vista mensual de asignaciones del mes actual
  const vistaMensual = await obtenerVistaMensual(tx, anioActual, mesActual);

  // 3. Cargar resultados del mes actual y del mes anterior
  const mesPrev = calcularMesAnterior(anioActual, mesActual);
  const [resultadosMesActual, resultadosMesAnterior] = await Promise.all([
    obtenerResultadosAreas(tx, autenticacion, { anio: anioActual, mes: mesActual }),
    obtenerResultadosAreas(tx, autenticacion, { anio: mesPrev.anio, mes: mesPrev.mes }),
  ]);

  // Calcular Resultado Global del mes anterior
  const areasConResultado = resultadosMesAnterior.areas.filter((a) => a.resultadoMensual !== null);
  const sumaGlobal = areasConResultado.reduce((acc, curr) => acc + (curr.resultadoMensual ?? 0), 0);
  const porcentajeGlobal = areasConResultado.length > 0 ? sumaGlobal / areasConResultado.length : null;

  const resultadoGlobal = {
    clave: mesPrev.clave,
    etiqueta: `${MESES[mesPrev.mes - 1]} ${mesPrev.anio}`,
    porcentaje: porcentajeGlobal,
    totalAreas: resultadosMesAnterior.areas.length,
    areasConResultado: areasConResultado.length,
  };

  // 4. Buscar Objetivos realizables del mes anterior (período hábil de gracia o reabierto) para vista admin
  const objetivosPreviosHabiles = await tx.objetivoAuditoria.findMany({
    where: {
      iniciaEn: { lte: ahora },
      canceladoEn: null,
      envioResultadoId: null,
      NOT: {
        anio: anioActual,
        mes: mesActual,
      },
    },
    include: {
      envioResultado: true,
      area: { select: { id: true, nombre: true, codigo: true } },
      asignacionesAuditoria: {
        where: { estado: { not: EstadoAsignacionAuditoria.CANCELADA } },
        include: { auditor: { select: { id: true, nombre: true } } },
        orderBy: { creadoEn: 'desc' },
      },
    },
    orderBy: [
      { anio: 'asc' },
      { mes: 'asc' },
      { periodo: 'asc' },
    ],
  });

  const previosPorAreaMap = new Map<number, {
    id: number;
    asignacionId: number | null;
    periodo: number;
    mesNombre: string;
    estado: string;
    reabierta: boolean;
    enGracia: boolean;
    auditorNombre: string | null;
  }>();

  for (const obj of objetivosPreviosHabiles) {
    const asignacion = obj.asignacionesAuditoria[0] ?? null;
    const reabiertaHasta = asignacion?.reabiertaHasta ?? null;
    if (!objetivoEsRealizable(obj, ahora, reabiertaHasta)) continue;

    const detalle = derivarSituacionObjetivo(obj, ahora);
    const enGracia = detalle.situacion === SituacionObjetivo.ATRASADA_EN_GRACIA;

    previosPorAreaMap.set(obj.areaId, {
      id: obj.id,
      asignacionId: asignacion?.id ?? null,
      periodo: obj.periodo,
      mesNombre: MESES[obj.mes - 1],
      estado: enGracia ? 'Atrasada' : reabiertaHasta ? 'Reabierta' : 'Pendiente',
      reabierta: Boolean(reabiertaHasta),
      enGracia,
      auditorNombre: asignacion?.auditor?.nombre ?? null,
    });
  }

  // 5. Cargar auditorías personales ejecutables para el usuario autenticado (misma lógica que /mis-auditorias)
  const ejecutablesPersonales = await obtenerEjecutablesUsuario(tx, autenticacion.usuarioId, ahora);

  const porPeriodoMap = new Map<string, {
    mesNombre: string;
    periodo: number;
    anio: number;
    conteo: number;
    estadoSemantico: 'ATRASADA' | 'ACTIVA';
  }>();

  for (const asig of ejecutablesPersonales) {
    const obj = asig.objetivoAuditoria;
    const key = `${obj.anio}-${obj.mes}-P${obj.periodo}`;
    const exist = porPeriodoMap.get(key);

    const esAtrasada = asig.infoPeriodo.status === 'VENCIDA' || asig.infoPeriodo.status === 'REABIERTA' || ahora > new Date(obj.terminaEn);
    const estadoSemantico: 'ATRASADA' | 'ACTIVA' = esAtrasada ? 'ATRASADA' : 'ACTIVA';

    if (exist) {
      exist.conteo += 1;
    } else {
      porPeriodoMap.set(key, {
        mesNombre: MESES[obj.mes - 1],
        periodo: obj.periodo,
        anio: obj.anio,
        conteo: 1,
        estadoSemantico,
      });
    }
  }

  const misPendientesResumen = {
    total: ejecutablesPersonales.length,
    grupos: Array.from(porPeriodoMap.values()),
  };

  // 6. Departamentos a su cargo
  const mapPrev = new Map(resultadosMesAnterior.areas.map((a) => [a.area.id, a]));
  const departamentosCargo = resultadosMesActual.areas
    .filter((a) => a.area.esPropia)
    .map((aActual) => {
      const aPrev = mapPrev.get(aActual.area.id);
      return {
        areaId: aActual.area.id,
        nombre: aActual.area.nombre,
        codigo: aActual.area.codigo,
        etiquetaMesActual: resultadosMesActual.mes.etiqueta,
        claveMesActual: resultadosMesActual.mes.clave,
        periodosActuales: aActual.periodos.map((p) => ({
          periodo: p.periodo,
          completado: p.completado,
          estado: p.estado,
          porcentaje: p.porcentaje,
        })),
        resultadoAnterior: {
          clave: resultadosMesAnterior.mes.clave,
          etiqueta: resultadosMesAnterior.mes.etiqueta,
          porcentaje: aPrev?.resultadoMensual ?? null,
        },
      };
    });

  if (esAdmin) {
    // -------------------------------------------------------------
    // VISTA ADMINISTRADOR (Control de Auditorías)
    // -------------------------------------------------------------

    let asignadas = 0;
    let pendientes = 0;
    let realizadas = 0;
    let sinAuditor = 0;

    for (const fila of vistaMensual.filas) {
      if (fila.estado === 'ASIGNADO') asignadas += 1;
      if (fila.estado === 'SIN_AUDITOR') sinAuditor += 1;

      if (fila.periodos.p1.programada) {
        if (fila.periodos.p1.realizada) realizadas += 1;
        else if (!fila.periodos.p1.requiereAuditor) pendientes += 1;
      }
      if (fila.periodos.p2.programada) {
        if (fila.periodos.p2.realizada) realizadas += 1;
        else if (!fila.periodos.p2.requiereAuditor) pendientes += 1;
      }
    }

    const mapActual = new Map(resultadosMesActual.areas.map((a) => [a.area.id, a]));
    const mostrarMesAnterior = previosPorAreaMap.size > 0;

    const controlFilas = vistaMensual.filas.map((fila) => {
      const previo = previosPorAreaMap.get(fila.area.id) ?? null;
      const aPrev = mapPrev.get(fila.area.id);
      const aActual = mapActual.get(fila.area.id);

      return {
        area: fila.area,
        auditorMensual: fila.auditorMensual,
        mesAnterior: {
          clave: mesPrev.clave,
          etiqueta: `${MESES[mesPrev.mes - 1]} ${mesPrev.anio}`,
          periodoAnterior: previo ? {
            periodo: previo.periodo,
            mesNombre: previo.mesNombre,
            auditorNombre: previo.auditorNombre,
            estado: previo.estado,
            reabierta: previo.reabierta,
            enGracia: previo.enGracia,
          } : null,
          periodos: {
            p1: aPrev?.periodos?.find((p) => p.periodo === 1) ? {
              programada: true,
              realizada: aPrev.periodos.find((p) => p.periodo === 1)?.completado,
              estadoAuditoria: aPrev.periodos.find((p) => p.periodo === 1)?.estado,
              vencida: !aPrev.periodos.find((p) => p.periodo === 1)?.completado,
            } : (previo?.periodo === 1 ? {
              programada: true,
              realizada: false,
              estadoAuditoria: previo.estado,
              vencida: previo.enGracia || previo.estado === 'Atrasada',
              reabiertaHasta: previo.reabierta ? new Date() : null,
            } : { programada: false }),
            p2: aPrev?.periodos?.find((p) => p.periodo === 2) ? {
              programada: true,
              realizada: aPrev.periodos.find((p) => p.periodo === 2)?.completado,
              estadoAuditoria: aPrev.periodos.find((p) => p.periodo === 2)?.estado,
              vencida: !aPrev.periodos.find((p) => p.periodo === 2)?.completado,
            } : (previo?.periodo === 2 ? {
              programada: true,
              realizada: false,
              estadoAuditoria: previo.estado,
              vencida: previo.enGracia || previo.estado === 'Atrasada',
              reabiertaHasta: previo.reabierta ? new Date() : null,
            } : { programada: false }),
          },
          resultado: aPrev?.resultadoMensual ?? null,
        },
        mesActual: {
          clave: `${anioActual}-${String(mesActual).padStart(2, '0')}`,
          etiqueta: `${MESES[mesActual - 1]} ${anioActual}`,
          auditorMensual: fila.auditorMensual,
          periodos: fila.periodos,
          resultado: aActual?.resultadoMensual ?? null,
        },
      };
    });

    const periodosResumen = construirPeriodosResumen(vistaMensual.filas, true, autenticacion.usuarioId, anioActual, mesActual, ahora);

    return {
      rol: autenticacion.rol,
      mesControl: `${anioActual}-${String(mesActual).padStart(2, '0')}`,
      etiquetaMesControl: `${MESES[mesActual - 1]} ${anioActual}`,
      etiquetaMesAnterior: `${MESES[mesPrev.mes - 1]} ${mesPrev.anio}`,
      mostrarMesAnterior,
      periodosResumen,
      resumen: {
        asignadas,
        pendientes,
        realizadas,
        sinAuditor,
      },
      controlFilas,
      resultadoGlobal,
      misPendientesResumen,
      departamentosCargo,
    };
  }

  // -------------------------------------------------------------
  // VISTA AUDITOR / OTROS ROLES
  // -------------------------------------------------------------

  let auditorAsignadas = 0;
  let auditorPendientes = 0;
  let auditorRealizadas = 0;

  for (const fila of vistaMensual.filas) {
    const periodos = [fila.periodos.p1, fila.periodos.p2];
    for (const p of periodos) {
      if (!p.programada) continue;
      if (p.auditorEfectivo?.id === autenticacion.usuarioId) {
        auditorAsignadas += 1;
        if (p.realizada) auditorRealizadas += 1;
        else auditorPendientes += 1;
      }
    }
  }

  const periodosResumen = construirPeriodosResumen(vistaMensual.filas, false, autenticacion.usuarioId, anioActual, mesActual, ahora);

  return {
    rol: autenticacion.rol,
    mesControl: `${anioActual}-${String(mesActual).padStart(2, '0')}`,
    etiquetaMesControl: `${MESES[mesActual - 1]} ${anioActual}`,
    periodosResumen,
    resumen: {
      asignadas: auditorAsignadas,
      pendientes: auditorPendientes,
      realizadas: auditorRealizadas,
    },
    resultadoGlobal,
    departamentosCargo,
    misPendientesResumen,
  };
};

const MESES_NOMBRES_MIN = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

const construirPeriodosResumen = (
  filas: Awaited<ReturnType<typeof obtenerVistaMensual>>['filas'],
  esAdmin: boolean,
  usuarioId: number,
  anio: number,
  mes: number,
  ahora = new Date(),
) => {
  return ([1, 2] as const).map((periodoNum) => {
    const pMeta = periodoMensual(anio, mes, periodoNum);
    const pKey = periodoNum === 1 ? 'p1' : 'p2';
    const cierreGracia = calcularCierreConGracia(pMeta.terminaEn);

    let estadoTemporal: 'AUN_NO_INICIA' | 'EN_CURSO' | 'ATRASADO' | 'FINALIZADO' = 'AUN_NO_INICIA';
    if (ahora < pMeta.iniciaEn) {
      estadoTemporal = 'AUN_NO_INICIA';
    } else if (ahora <= pMeta.terminaEn) {
      estadoTemporal = 'EN_CURSO';
    } else if (ahora <= cierreGracia) {
      estadoTemporal = 'ATRASADO';
    } else {
      estadoTemporal = 'FINALIZADO';
    }

    const mesNombreMin = MESES_NOMBRES_MIN[mes - 1];
    const diaInicio = pMeta.iniciaEn.getDate();
    const diaFin = pMeta.terminaEn.getDate();
    const rangoFechas = `${diaInicio} – ${diaFin} ${mesNombreMin}`;

    let totalAuditorias = 0;
    let realizadas = 0;
    let pendientes = 0;
    let atrasadas = 0;
    let noRealizadas = 0;
    let areasSinAuditor = 0;

    for (const fila of filas) {
      const pData = fila.periodos[pKey];
      if (!pData || !pData.programada) continue;

      if (!esAdmin) {
        if (pData.auditorEfectivo?.id !== usuarioId) continue;
      }

      totalAuditorias += 1;

      if (esAdmin && pData.requiereAuditor) {
        areasSinAuditor += 1;
      }

      if (pData.realizada) {
        realizadas += 1;
      } else if (estadoTemporal === 'FINALIZADO' || pData.estadoAuditoria === 'NO_REALIZADA' || (pData.vencida && ahora > cierreGracia)) {
        noRealizadas += 1;
      } else if (estadoTemporal === 'ATRASADO' || pData.estadoAuditoria === 'ATRASADA_EN_GRACIA' || (pData.vencida && ahora <= cierreGracia)) {
        atrasadas += 1;
      } else if (estadoTemporal === 'EN_CURSO') {
        pendientes += 1;
      } else if (estadoTemporal === 'AUN_NO_INICIA') {
        pendientes = 0;
      }
    }

    return {
      periodo: periodoNum,
      etiqueta: periodoNum === 1 ? 'Primer periodo' : 'Segundo periodo',
      rangoFechas,
      iniciaEn: pMeta.iniciaEn,
      terminaEn: pMeta.terminaEn,
      cierreGracia,
      estadoTemporal,
      totalAuditorias,
      realizadas,
      pendientes,
      atrasadas,
      noRealizadas,
      areasSinAuditor,
    };
  });
};
