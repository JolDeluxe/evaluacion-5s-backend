/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, beforeEach, describe, expect, setSystemTime, test } from 'bun:test';
import { prisma } from '../db';
import {
  AlcanceFormulario,
  EstadoAsignacionAuditoria,
  OrigenEnvioAuditoria,
  RolUsuario,
  TipoArea,
} from '../generated/prisma/enums';
import { reabrirAsignacionEnTransaccion } from '../modules/asignaciones/12_reabrir';
import {
  bloquearObjetivoAuditoria,
  obtenerVersionFormularioActivaPorTipoArea,
  reconciliarObjetivoPendienteConArea,
  sincronizarObjetivosPendientesDeArea,
} from '../modules/asignaciones/helper';
import { asegurarProgramacionMensual } from '../modules/asignaciones/programacion_mensual';
import { calcularPuntaje5S, validarCodigoArea, validarRespuestas5S } from '../modules/auditorias/helper';
import { obtenerResultadosRangoGeneral } from '../modules/resultados/rpt_rango_helper';
import { obtenerResultadosAreas, obtenerResultadosGeneral } from '../modules/resultados/servicio';
import { conflicto } from '../utils/errores';
import { transaccionSerializable } from '../utils/transaccion';

const crearTxMemoriaSincronizacion = () => {
  const formularios = [
    { id: 1, codigo: 'FORM-OP', nombre: 'Formulario Operativo', alcance: AlcanceFormulario.OPERATIVO, activo: true },
    { id: 2, codigo: 'FORM-ADM', nombre: 'Formulario Administrativo', alcance: AlcanceFormulario.ADMINISTRATIVO, activo: true },
  ];
  const versiones = [
    {
      id: 101,
      formularioId: 1,
      numeroVersion: 1,
      activa: true,
      formulario: formularios[0],
      secciones: [
        {
          id: 10,
          orden: 1,
          nombre: '1S Operativo',
          preguntas: [
            { id: 1001, orden: 1, texto: 'Pregunta Operativa 1', requiereHallazgo: true },
            { id: 1002, orden: 2, texto: 'Pregunta Operativa 2', requiereHallazgo: true },
          ],
        },
      ],
    },
    {
      id: 201,
      formularioId: 2,
      numeroVersion: 1,
      activa: true,
      formulario: formularios[1],
      secciones: [
        {
          id: 20,
          orden: 1,
          nombre: '1S Administrativo',
          preguntas: [
            { id: 2001, orden: 1, texto: 'Pregunta Administrativa 1', requiereHallazgo: true },
            { id: 2002, orden: 2, texto: 'Pregunta Administrativa 2', requiereHallazgo: true },
          ],
        },
      ],
    },
  ];

  const areas = [
    {
      id: 76,
      codigo: 'CELULA-DES',
      nombre: 'CELULA DE DESARROLLO',
      tipo: TipoArea.ADMINISTRATIVA,
      activo: true,
      codigoVerificacion: 'CELULA-76',
      auditableDesde: null,
      auditableHasta: null,
      usuariosArea: [],
    },
  ];

  const objetivos: any[] = [];

  const esElegibleUpdate = (obj: any, where: any) => {
    if (where.id?.in && !where.id.in.includes(obj.id)) return false;
    if (typeof where.id === 'number' && obj.id !== where.id) return false;
    if (where.areaId && obj.areaId !== where.areaId) return false;
    if (where.canceladoEn === null && obj.canceladoEn !== null) return false;
    if (where.envioResultadoId === null && obj.envioResultadoId !== null) return false;
    if (where.enviosAuditoria?.none && (obj.enviosAuditoria?.length ?? 0) > 0) return false;
    if (where.asignacionesAuditoria?.none) {
      const tieneBloqueante = (obj.asignacionesAuditoria ?? []).some(
        (a: any) =>
          a.estado === EstadoAsignacionAuditoria.COMPLETADA
          || a.estado === EstadoAsignacionAuditoria.EN_PROCESO
          || a.iniciadoEn !== null
          || a.completadoEn !== null,
      );
      if (tieneBloqueante) return false;
    }
    return true;
  };

  const tx: any = {
    formularios,
    versiones,
    areas,
    objetivos,
    $executeRaw: async () => 1,
    formulario: {
      findMany: async ({ where }: any) =>
        formularios.filter((f) => {
          if (where?.activo !== undefined && f.activo !== where.activo) return false;
          if (where?.alcance?.in && !where.alcance.in.includes(f.alcance)) return false;
          if (typeof where?.alcance === 'string' && f.alcance !== where.alcance) return false;
          return true;
        }),
    },
    versionFormulario: {
      findMany: async ({ where }: any) =>
        versiones
          .filter((v) => {
            if (where?.formulario?.activo !== undefined && v.formulario.activo !== where.formulario.activo) {
              return false;
            }
            if (where?.formulario?.alcance?.in && !where.formulario.alcance.in.includes(v.formulario.alcance)) {
              return false;
            }
            return true;
          })
          .sort((a, b) => b.numeroVersion - a.numeroVersion),
    },
    envioAuditoria: {
      findFirst: async () => null,
    },
    area: {
      findMany: async () => areas,
      findUniqueOrThrow: async ({ where }: any) => {
        const a = areas.find((x) => x.id === where.id);
        if (!a) throw new Error('Area no encontrada');
        return a;
      },
    },
    objetivoAuditoria: {
      findMany: async ({ where = {} }: any) =>
        objetivos.filter((obj) => {
          if (where.id && obj.id !== where.id) return false;
          if (where.areaId && obj.areaId !== where.areaId) return false;
          if (where.canceladoEn === null && obj.canceladoEn !== null) return false;
          if (where.envioResultadoId === null && obj.envioResultadoId !== null) return false;
          return true;
        }),
      updateMany: async ({ where, data }: any) => {
        let count = 0;
        for (const obj of objetivos) {
          if (esElegibleUpdate(obj, where)) {
            Object.assign(obj, data);
            count += 1;
          }
        }
        return { count };
      },
      upsert: async ({ where, create }: any) => {
        const key = where.areaId_anio_mes_periodo;
        let obj = objetivos.find(
          (o) =>
            o.areaId === key.areaId
            && o.anio === key.anio
            && o.mes === key.mes
            && o.periodo === key.periodo,
        );
        if (!obj) {
          obj = {
            id: objetivos.length + 1,
            envioResultadoId: null,
            envioResultado: null,
            enviosAuditoria: [],
            asignacionesAuditoria: [],
            canceladoEn: null,
            ...create,
          };
          objetivos.push(obj);
        }
        return obj;
      },
    },
  };

  return tx;
};

describe('Sincronización automática de formularios por tipo de área', () => {
  beforeEach(() => {
    setSystemTime(new Date(2026, 2, 18, 12, 0, 0)); // 18 de marzo de 2026
  });

  afterEach(() => {
    setSystemTime();
  });

  test('1. Sincroniza objetivos pendientes de todos los meses y años en ambas direcciones (ADMINISTRATIVA <-> OPERATIVA) respetando todas las protecciones', async () => {
    const tx = crearTxMemoriaSincronizacion();

    // Crear objetivos en distintos estados a lo largo del año 2026 y 2027
    tx.objetivos.push(
      // 1) Enero P1: Completado con envío válido -> PROTEGIDO
      {
        id: 1,
        areaId: 76,
        anio: 2026,
        mes: 1,
        periodo: 1,
        versionFormularioId: 201,
        tipoAreaSnapshot: TipoArea.ADMINISTRATIVA,
        codigoAreaSnapshot: 'CELULA-DES',
        nombreAreaSnapshot: 'CELULA DE DESARROLLO',
        canceladoEn: null,
        envioResultadoId: 5001,
        enviosAuditoria: [{ id: 5001 }],
        asignacionesAuditoria: [{ id: 10, estado: EstadoAsignacionAuditoria.COMPLETADA, iniciadoEn: null, completadoEn: new Date() }],
      },
      // 2) Febrero P1: Envío invalidado (envioResultadoId = null, pero enviosAuditoria tiene 1 registro) -> PROTEGIDO
      {
        id: 2,
        areaId: 76,
        anio: 2026,
        mes: 2,
        periodo: 1,
        versionFormularioId: 201,
        tipoAreaSnapshot: TipoArea.ADMINISTRATIVA,
        codigoAreaSnapshot: 'CELULA-DES',
        nombreAreaSnapshot: 'CELULA DE DESARROLLO',
        canceladoEn: null,
        envioResultadoId: null,
        enviosAuditoria: [{ id: 5002 }],
        asignacionesAuditoria: [{ id: 11, estado: EstadoAsignacionAuditoria.PENDIENTE, iniciadoEn: null, completadoEn: null }],
      },
      // 3) Febrero P2: Objetivo cancelado -> PROTEGIDO
      {
        id: 3,
        areaId: 76,
        anio: 2026,
        mes: 2,
        periodo: 2,
        versionFormularioId: 201,
        tipoAreaSnapshot: TipoArea.ADMINISTRATIVA,
        codigoAreaSnapshot: 'CELULA-DES',
        nombreAreaSnapshot: 'CELULA DE DESARROLLO',
        canceladoEn: new Date(2026, 1, 20),
        envioResultadoId: null,
        enviosAuditoria: [],
        asignacionesAuditoria: [],
      },
      // 4) Marzo P1: Evaluación iniciada (EN_PROCESO / iniciadoEn != null) -> PROTEGIDO
      {
        id: 4,
        areaId: 76,
        anio: 2026,
        mes: 3,
        periodo: 1,
        versionFormularioId: 201,
        tipoAreaSnapshot: TipoArea.ADMINISTRATIVA,
        codigoAreaSnapshot: 'CELULA-DES',
        nombreAreaSnapshot: 'CELULA DE DESARROLLO',
        canceladoEn: null,
        envioResultadoId: null,
        enviosAuditoria: [],
        asignacionesAuditoria: [{ id: 12, estado: EstadoAsignacionAuditoria.EN_PROCESO, iniciadoEn: new Date(2026, 2, 10), completadoEn: null }],
      },
      // 5) Marzo P2: Pendiente con asignación PENDIENTE no iniciada -> DEBE ACTUALIZARSE
      {
        id: 5,
        areaId: 76,
        anio: 2026,
        mes: 3,
        periodo: 2,
        versionFormularioId: 201,
        tipoAreaSnapshot: TipoArea.ADMINISTRATIVA,
        codigoAreaSnapshot: 'CELULA-DES',
        nombreAreaSnapshot: 'CELULA DE DESARROLLO',
        canceladoEn: null,
        envioResultadoId: null,
        enviosAuditoria: [],
        asignacionesAuditoria: [{ id: 13, estado: EstadoAsignacionAuditoria.PENDIENTE, iniciadoEn: null, completadoEn: null }],
      },
      // 6) Octubre P1 (mes futuro del mismo año): Pendiente sin asignación -> DEBE ACTUALIZARSE
      {
        id: 6,
        areaId: 76,
        anio: 2026,
        mes: 10,
        periodo: 1,
        versionFormularioId: 201,
        tipoAreaSnapshot: TipoArea.ADMINISTRATIVA,
        codigoAreaSnapshot: 'CELULA-DES',
        nombreAreaSnapshot: 'CELULA DE DESARROLLO',
        canceladoEn: null,
        envioResultadoId: null,
        enviosAuditoria: [],
        asignacionesAuditoria: [],
      },
      // 7) Enero 2027 P1 (año siguiente): Pendiente -> DEBE ACTUALIZARSE
      {
        id: 7,
        areaId: 76,
        anio: 2027,
        mes: 1,
        periodo: 1,
        versionFormularioId: 201,
        tipoAreaSnapshot: TipoArea.ADMINISTRATIVA,
        codigoAreaSnapshot: 'CELULA-DES',
        nombreAreaSnapshot: 'CELULA DE DESARROLLO',
        canceladoEn: null,
        envioResultadoId: null,
        enviosAuditoria: [],
        asignacionesAuditoria: [],
      },
    );

    // Dirección 1: ADMINISTRATIVA -> OPERATIVA
    tx.areas[0].tipo = TipoArea.OPERATIVA;
    const syncOp = await sincronizarObjetivosPendientesDeArea(tx, tx.areas[0]);

    expect(syncOp.versionFormularioId).toBe(101);
    expect(syncOp.objetivosActualizados).toBe(3);
    expect(syncOp.objetivosIds).toEqual([5, 6, 7]);

    // Verificar que los protegidos permanecieron intactos en 201 / ADMINISTRATIVA
    for (const idProtegido of [1, 2, 3, 4]) {
      const obj = tx.objetivos.find((o: any) => o.id === idProtegido);
      expect(obj.versionFormularioId).toBe(201);
      expect(obj.tipoAreaSnapshot).toBe(TipoArea.ADMINISTRATIVA);
    }

    // Verificar que los elegibles se actualizaron a 101 / OPERATIVA
    for (const idActualizado of [5, 6, 7]) {
      const obj = tx.objetivos.find((o: any) => o.id === idActualizado);
      expect(obj.versionFormularioId).toBe(101);
      expect(obj.tipoAreaSnapshot).toBe(TipoArea.OPERATIVA);
    }

    // Dirección 2: OPERATIVA -> ADMINISTRATIVA
    tx.areas[0].tipo = TipoArea.ADMINISTRATIVA;
    const syncAdm = await sincronizarObjetivosPendientesDeArea(tx, tx.areas[0]);

    expect(syncAdm.versionFormularioId).toBe(201);
    expect(syncAdm.objetivosActualizados).toBe(3);
    expect(syncAdm.objetivosIds).toEqual([5, 6, 7]);

    for (const idActualizado of [5, 6, 7]) {
      const obj = tx.objetivos.find((o: any) => o.id === idActualizado);
      expect(obj.versionFormularioId).toBe(201);
      expect(obj.tipoAreaSnapshot).toBe(TipoArea.ADMINISTRATIVA);
    }
  });

  test('2. Validación de versión activa única: aborta con conflicto si faltan formularios/versiones o si hay ambigüedad (>1 activos)', async () => {
    const tx = crearTxMemoriaSincronizacion();

    // Caso A: Dos versiones activas para el mismo alcance OPERATIVO
    tx.versiones.push({
      id: 102,
      formularioId: 1,
      numeroVersion: 2,
      activa: true,
      formulario: tx.formularios[0],
      secciones: [],
    });

    await expect(
      obtenerVersionFormularioActivaPorTipoArea(tx, TipoArea.OPERATIVA),
    ).rejects.toThrow('versiones activas');

    // Restaurar a 1 versión activa y probar múltiples formularios activos para el mismo alcance
    tx.versiones.pop();
    tx.formularios.push({
      id: 3,
      codigo: 'FORM-OP-2',
      nombre: 'Segundo Formulario Operativo',
      alcance: AlcanceFormulario.OPERATIVO,
      activo: true,
    });

    await expect(
      obtenerVersionFormularioActivaPorTipoArea(tx, TipoArea.OPERATIVA),
    ).rejects.toThrow('formularios activos');

    // Caso C: Ningún formulario activo para el alcance
    tx.formularios.length = 0;
    await expect(
      obtenerVersionFormularioActivaPorTipoArea(tx, TipoArea.OPERATIVA),
    ).rejects.toThrow('No existe formulario activo');
  });

  test('3. Reconciliación defensiva en asegurarProgramacionMensual, apertura de contexto y reapertura de asignación', async () => {
    const tx = crearTxMemoriaSincronizacion();

    // Programar marzo 2026 inicialmente como ADMINISTRATIVA (201)
    await asegurarProgramacionMensual(tx, 2026, 3, 1);
    expect(tx.objetivos).toHaveLength(2);
    expect(tx.objetivos[0].versionFormularioId).toBe(201);
    expect(tx.objetivos[1].versionFormularioId).toBe(201);

    // Simular que P1 se completó como ADMINISTRATIVA y luego el área cambió a OPERATIVA
    tx.objetivos[0].envioResultadoId = 9001;
    tx.objetivos[0].enviosAuditoria = [{ id: 9001 }];
    tx.areas[0].tipo = TipoArea.OPERATIVA;

    // Al volver a asegurar la programación mensual, P1 completada se respeta (201) y P2 pendiente se reconcilia (101)
    await asegurarProgramacionMensual(tx, 2026, 3, 1);
    expect(tx.objetivos[0].versionFormularioId).toBe(201);
    expect(tx.objetivos[0].tipoAreaSnapshot).toBe(TipoArea.ADMINISTRATIVA);
    expect(tx.objetivos[1].versionFormularioId).toBe(101);
    expect(tx.objetivos[1].tipoAreaSnapshot).toBe(TipoArea.OPERATIVA);

    // Probar reconciliarObjetivoPendienteConArea cuando un objetivo pendiente tenía aún 201
    tx.objetivos[1].versionFormularioId = 201;
    tx.objetivos[1].tipoAreaSnapshot = TipoArea.ADMINISTRATIVA;
    const reconciliado = await reconciliarObjetivoPendienteConArea(tx, tx.objetivos[1], tx.areas[0]);
    expect(reconciliado.reconciliado).toBe(true);
    expect(reconciliado.versionFormulario.id).toBe(101);
    expect(tx.objetivos[1].versionFormularioId).toBe(101);
    expect(tx.objetivos[1].tipoAreaSnapshot).toBe(TipoArea.OPERATIVA);
  });

  test('4. Política areaId + anio + mes: Área que cambia de ADMINISTRATIVA a OPERATIVA a mitad de marzo en filtros mensual, trimestral, semestral y anual', async () => {
    // Escenario:
    // Área 76 (CELULA DE DESARROLLO):
    // - Enero 2026: P1 = ADMINISTRATIVA (90%), P2 = ADMINISTRATIVA (90%) -> Mensual Enero = 90% (ADMINISTRATIVA)
    // - Febrero 2026: P1 = ADMINISTRATIVA (80%), P2 = ADMINISTRATIVA (80%) -> Mensual Febrero = 80% (ADMINISTRATIVA)
    // - Marzo 2026:
    //   - P1 finalizada como ADMINISTRATIVA (70%, 1 hallazgo en pregunta administrativa 2001)
    //   - A mitad de marzo cambia a OPERATIVA
    //   - P2 actualizada y finalizada como OPERATIVA (100%, 0 hallazgos en preguntas operativas 1001)
    //   -> Unidad Marzo (76, 2026, 3) tiene último periodo P2 = OPERATIVA, incluye P1 y P2, Mensual Marzo = 85% (OPERATIVA)

    const crearObjetivoMock = (
      id: number,
      mes: number,
      periodo: 1 | 2,
      tipoSnapshot: TipoArea,
      porcentaje: number,
      cumplePregunta: boolean,
    ) => {
      const esAdm = tipoSnapshot === TipoArea.ADMINISTRATIVA;
      const pregId = esAdm ? 2001 : 1001;
      const pregTexto = esAdm ? '¿Escritorio administrativo libre?' : '¿Pasillo operativo despejado?';
      const seccionId = esAdm ? 20 : 10;
      const seccionNombre = esAdm ? '1S Administrativo' : '1S Operativo';

      return {
        id,
        areaId: 76,
        anio: 2026,
        mes,
        periodo,
        versionFormularioId: esAdm ? 201 : 101,
        iniciaEn: new Date(2026, mes - 1, periodo === 1 ? 1 : 16, 0, 0, 0),
        terminaEn: new Date(2026, mes - 1, periodo === 1 ? 15 : 28, 23, 59, 59),
        codigoAreaSnapshot: 'CELULA-DES',
        nombreAreaSnapshot: 'CELULA DE DESARROLLO',
        tipoAreaSnapshot: tipoSnapshot,
        canceladoEn: null,
        envioResultadoId: id * 100,
        area: {
          activo: true,
          auditableDesde: null,
          auditableHasta: null,
        },
        envioResultado: {
          id: id * 100,
          invalidadoEn: null,
          porcentaje,
          puntajeObtenido: cumplePregunta ? 10 : 7,
          puntajePosible: 10,
          verificadoEn: new Date(2026, mes - 1, periodo === 1 ? 10 : 25, 10, 0, 0),
          finalizadoEn: new Date(2026, mes - 1, periodo === 1 ? 10 : 25, 10, 0, 0),
          realizadaATiempo: true,
          nombreAuditorSnapshot: 'Auditor Prueba',
          asignacionAuditoria: {
            auditorId: 10,
            auditor: { nombre: 'Auditor Prueba' },
          },
          respuestasAuditoria: [
            {
              id: id * 1000,
              cumple: cumplePregunta,
              preguntaFormulario: {
                id: pregId,
                texto: pregTexto,
                seccionFormulario: {
                  id: seccionId,
                  nombre: seccionNombre,
                },
              },
              fotosAuditoria: [],
            },
          ],
        },
      };
    };

    const todosObjetivos = [
      // Enero: ADMINISTRATIVA (90%, 90%)
      crearObjetivoMock(1, 1, 1, TipoArea.ADMINISTRATIVA, 90, true),
      crearObjetivoMock(2, 1, 2, TipoArea.ADMINISTRATIVA, 90, true),
      // Febrero: ADMINISTRATIVA (80%, 80%)
      crearObjetivoMock(3, 2, 1, TipoArea.ADMINISTRATIVA, 80, true),
      crearObjetivoMock(4, 2, 2, TipoArea.ADMINISTRATIVA, 80, true),
      // Marzo: P1 = ADMINISTRATIVA (70%, con incidencia), P2 = OPERATIVA (100%)
      crearObjetivoMock(5, 3, 1, TipoArea.ADMINISTRATIVA, 70, false),
      crearObjetivoMock(6, 3, 2, TipoArea.OPERATIVA, 100, true),
    ];

    const txResultados: any = {
      usuarioArea: { findMany: async () => [] },
      objetivoAuditoria: {
        findMany: async ({ where }: any) => {
          return todosObjetivos.filter((o) => {
            if (where.anio && o.anio !== where.anio) return false;
            if (typeof where.mes === 'number' && o.mes !== where.mes) return false;
            if (where.mes?.in && !where.mes.in.includes(o.mes)) return false;
            if (where.tipoAreaSnapshot && o.tipoAreaSnapshot !== where.tipoAreaSnapshot) return false;
            return true;
          });
        },
      },
    };

    const authAdmin = { usuarioId: 1, rol: RolUsuario.ADMINISTRADOR };

    // A. Filtro MENSUAL de Marzo (2026-03)
    const marzoSinFiltro = (await obtenerResultadosGeneral(txResultados, authAdmin, { mes: '2026-03' })) as any;
    expect(marzoSinFiltro.areas).toHaveLength(1);
    expect(marzoSinFiltro.areas[0].area.tipo).toBe(TipoArea.OPERATIVA);
    expect(marzoSinFiltro.areas[0].resultadoMensual).toBe(85); // Promedio de P1 (70) y P2 (100)
    expect(marzoSinFiltro.areas[0].estadoMes).toBe('REALIZADA');
    expect(marzoSinFiltro.incidenciasPorTipo?.administrativo).toHaveLength(1);
    expect(marzoSinFiltro.incidenciasPorTipo?.administrativo[0].preguntaId).toBe(2001);
    expect(marzoSinFiltro.incidenciasPorTipo?.operativo).toHaveLength(0);

    // Marzo filtrado por OPERATIVA: debe incluir P1 y P2 completos sin convertir P1 en NO_REALIZADA
    const marzoOperativa = await obtenerResultadosAreas(txResultados, authAdmin, {
      mes: '2026-03',
      tipoArea: TipoArea.OPERATIVA,
    });
    expect(marzoOperativa.areas).toHaveLength(1);
    expect(marzoOperativa.areas[0].area.tipo).toBe(TipoArea.OPERATIVA);
    expect(marzoOperativa.areas[0].resultadoMensual).toBe(85);
    expect(marzoOperativa.areas[0].periodos.map((p) => p.estado)).toEqual(['REALIZADA', 'REALIZADA']);
    expect(marzoOperativa.resumen.periodosNoRealizados).toBe(0);

    // Marzo filtrado por ADMINISTRATIVA: el área-mes Marzo es OPERATIVA, por lo que no aparece ni genera falsas NO_REALIZADA
    const marzoAdministrativa = await obtenerResultadosAreas(txResultados, authAdmin, {
      mes: '2026-03',
      tipoArea: TipoArea.ADMINISTRATIVA,
    });
    expect(marzoAdministrativa.areas).toHaveLength(0);
    expect(marzoAdministrativa.resumen.periodosNoRealizados).toBe(0);

    // Enero histórico cerrado conserva su clasificación ADMINISTRATIVA
    const eneroAdministrativa = await obtenerResultadosAreas(txResultados, authAdmin, {
      mes: '2026-01',
      tipoArea: TipoArea.ADMINISTRATIVA,
    });
    expect(eneroAdministrativa.areas).toHaveLength(1);
    expect(eneroAdministrativa.areas[0].area.tipo).toBe(TipoArea.ADMINISTRATIVA);
    expect(eneroAdministrativa.areas[0].resultadoMensual).toBe(90);

    // B. Filtro TRIMESTRAL Q1 (Enero, Febrero, Marzo)
    const q1Administrativa = await obtenerResultadosRangoGeneral(
      txResultados,
      authAdmin,
      { tipo: 'trimestre', anio: 2026, trimestre: 1, tipoArea: TipoArea.ADMINISTRATIVA },
      { alcanceGeneral: true },
    );
    expect(q1Administrativa.areas).toHaveLength(1);
    expect(q1Administrativa.areas[0].area.tipo).toBe(TipoArea.ADMINISTRATIVA);
    // Enero (90) y Febrero (80) incluidos; Marzo excluido porque Marzo fue OPERATIVA
    expect(q1Administrativa.areas[0].mesesDetalle.map((m) => m.resultadoMensual)).toEqual([90, 80, null]);
    expect(q1Administrativa.areas[0].resultadoRango).toBe(85); // Promedio de 90 y 80
    expect(q1Administrativa.areas[0].auditoriasRequeridas).toBe(4);
    expect(q1Administrativa.areas[0].auditoriasCompletadas).toBe(4);

    const q1Operativa = await obtenerResultadosRangoGeneral(
      txResultados,
      authAdmin,
      { tipo: 'trimestre', anio: 2026, trimestre: 1, tipoArea: TipoArea.OPERATIVA },
      { alcanceGeneral: true },
    );
    expect(q1Operativa.areas).toHaveLength(1);
    expect(q1Operativa.areas[0].area.tipo).toBe(TipoArea.OPERATIVA);
    // Solo Marzo (85, con P1 y P2 completos) incluido como OPERATIVA
    expect(q1Operativa.areas[0].mesesDetalle.map((m) => m.resultadoMensual)).toEqual([null, null, 85]);
    expect(q1Operativa.areas[0].resultadoRango).toBe(85);
    expect(q1Operativa.areas[0].auditoriasRequeridas).toBe(2);
    expect(q1Operativa.areas[0].auditoriasCompletadas).toBe(2);

    // C. Filtro SEMESTRAL H1 (Enero - Junio)
    const h1Administrativa = await obtenerResultadosRangoGeneral(
      txResultados,
      authAdmin,
      { tipo: 'semestre', anio: 2026, semestre: 1, tipoArea: TipoArea.ADMINISTRATIVA },
      { alcanceGeneral: true },
    );
    expect(h1Administrativa.areas).toHaveLength(1);
    expect(h1Administrativa.areas[0].mesesDetalle.slice(0, 3).map((m) => m.resultadoMensual)).toEqual([90, 80, null]);
    expect(h1Administrativa.areas[0].resultadoRango).toBe(85);

    const h1Operativa = await obtenerResultadosRangoGeneral(
      txResultados,
      authAdmin,
      { tipo: 'semestre', anio: 2026, semestre: 1, tipoArea: TipoArea.OPERATIVA },
      { alcanceGeneral: true },
    );
    expect(h1Operativa.areas).toHaveLength(1);
    expect(h1Operativa.areas[0].mesesDetalle.slice(0, 3).map((m) => m.resultadoMensual)).toEqual([null, null, 85]);
    expect(h1Operativa.areas[0].resultadoRango).toBe(85);

    // D. Filtro ANUAL (2026)
    const anualAdministrativa = await obtenerResultadosRangoGeneral(
      txResultados,
      authAdmin,
      { tipo: 'anio', anio: 2026, tipoArea: TipoArea.ADMINISTRATIVA },
      { alcanceGeneral: true },
    );
    expect(anualAdministrativa.areas).toHaveLength(1);
    expect(anualAdministrativa.areas[0].mesesDetalle.slice(0, 3).map((m) => m.resultadoMensual)).toEqual([90, 80, null]);
    expect(anualAdministrativa.areas[0].resultadoRango).toBe(85);

    const anualOperativa = await obtenerResultadosRangoGeneral(
      txResultados,
      authAdmin,
      { tipo: 'anio', anio: 2026, tipoArea: TipoArea.OPERATIVA },
      { alcanceGeneral: true },
    );
    expect(anualOperativa.areas).toHaveLength(1);
    expect(anualOperativa.areas[0].mesesDetalle.slice(0, 3).map((m) => m.resultadoMensual)).toEqual([null, null, 85]);
    expect(anualOperativa.areas[0].resultadoRango).toBe(85);
  });

  test('5. Concurrencia REAL en base de datos (Orden 1 y Orden 2): nunca se guardan respuestas de una versión en un objetivo sellado con otra versión', async () => {
    const sufijo = Date.now().toString().slice(-6);
    const idsFormulariosCreados: number[] = [];
    let idUsuarioCreado: number | null = null;

    let usuarioAuditor = await prisma.usuario.findFirst({ where: { activo: true } });
    if (!usuarioAuditor) {
      usuarioAuditor = await prisma.usuario.create({
        data: {
          nombre: `Auditor Concurrencia ${sufijo}`,
          nombreUsuario: `auditor_conc_${sufijo}`,
          correo: `auditor_conc_${sufijo}@test.local`,
          hashContrasena: 'hash',
          rol: RolUsuario.AUDITOR,
          activo: true,
        },
      });
      idUsuarioCreado = usuarioAuditor.id;
    }

    const asegurarFormularioUnicoTest = async (alcance: AlcanceFormulario, etiqueta: string) => {
      const existentes = await prisma.formulario.findMany({
        where: { activo: true, alcance },
        include: { versiones: { where: { activa: true } } },
      });
      if (existentes.length === 1 && existentes[0].versiones.length === 1) {
        return;
      }
      const creado = await prisma.formulario.create({
        data: {
          nombre: `Formulario ${etiqueta} Test ${sufijo}`,
          slug: `form-${etiqueta.toLowerCase()}-test-${sufijo}`,
          alcance,
          activo: true,
          creadoPorId: usuarioAuditor!.id,
          versiones: {
            create: {
              numeroVersion: 1,
              activa: true,
              creadoPorId: usuarioAuditor!.id,
              secciones: {
                create: {
                  claveEstable: `SEC-${etiqueta}-${sufijo}`,
                  nombre: `1S ${etiqueta}`,
                  objetivo: `Objetivo ${etiqueta}`,
                  orden: 1,
                  preguntas: {
                    create: [
                      {
                        claveEstable: `PREG-${etiqueta}-1-${sufijo}`,
                        texto: `Pregunta 1 ${etiqueta}`,
                        orden: 1,
                        requiereHallazgo: true,
                      },
                      {
                        claveEstable: `PREG-${etiqueta}-2-${sufijo}`,
                        texto: `Pregunta 2 ${etiqueta}`,
                        orden: 2,
                        requiereHallazgo: true,
                      },
                    ],
                  },
                },
              },
            },
          },
        },
      });
      idsFormulariosCreados.push(creado.id);
    };

    await asegurarFormularioUnicoTest(AlcanceFormulario.ADMINISTRATIVO, 'ADM');
    await asegurarFormularioUnicoTest(AlcanceFormulario.OPERATIVO, 'OP');

    const [versionAdm, versionOp] = await Promise.all([
      obtenerVersionFormularioActivaPorTipoArea(prisma, TipoArea.ADMINISTRATIVA),
      obtenerVersionFormularioActivaPorTipoArea(prisma, TipoArea.OPERATIVA),
    ]);

    const preguntasAdm = versionAdm.secciones.flatMap((s) => s.preguntas);
    const preguntasOp = versionOp.secciones.flatMap((s) => s.preguntas);
    expect(preguntasAdm.length).toBeGreaterThan(0);
    expect(preguntasOp.length).toBeGreaterThan(0);

    const codigoTemp = `CONC-${sufijo}`;

    // Crear área temporal aislada en encuestas_5s_test y limpiarla siempre en finally
    const areaTemp = await prisma.area.create({
      data: {
        codigo: codigoTemp,
        nombre: `AREA CONCURRENCIA ${sufijo}`,
        tipo: TipoArea.ADMINISTRATIVA,
        codigoVerificacion: `QR-${sufijo}`,
        activo: true,
      },
    });

    try {
      // Crear 2 objetivos pendientes originalmente ADMINISTRATIVOS:
      // - objOrden1 (periodo 1): para probar Orden 1 (Envío confirma antes del cambio de tipo de área)
      // - objOrden2 (periodo 2): para probar Orden 2 (Cambio de tipo de área confirma antes del envío)
      const [objOrden1, objOrden2] = await Promise.all([
        prisma.objetivoAuditoria.create({
          data: {
            areaId: areaTemp.id,
            anio: 2026,
            mes: 3,
            periodo: 1,
            versionFormularioId: versionAdm.id,
            iniciaEn: new Date(2026, 2, 1),
            terminaEn: new Date(2026, 2, 15, 23, 59, 59),
            codigoAreaSnapshot: areaTemp.codigo,
            nombreAreaSnapshot: areaTemp.nombre,
            tipoAreaSnapshot: TipoArea.ADMINISTRATIVA,
          },
        }),
        prisma.objetivoAuditoria.create({
          data: {
            areaId: areaTemp.id,
            anio: 2026,
            mes: 3,
            periodo: 2,
            versionFormularioId: versionAdm.id,
            iniciaEn: new Date(2026, 2, 16),
            terminaEn: new Date(2026, 2, 31, 23, 59, 59),
            codigoAreaSnapshot: areaTemp.codigo,
            nombreAreaSnapshot: areaTemp.nombre,
            tipoAreaSnapshot: TipoArea.ADMINISTRATIVA,
          },
        }),
      ]);

      const respuestasFormularioAdm = preguntasAdm.map((p) => ({
        preguntaFormularioId: p.id,
        cumple: true,
        hallazgo: null,
        fotos: [],
      }));

      // Función que ejecuta la lógica transaccional real de envío de auditoría
      const ejecutarTransaccionEnvio = async (objetivoId: number, respuestasPayload: typeof respuestasFormularioAdm, idCliente: string) => {
        return transaccionSerializable(async (tx) => {
          await bloquearObjetivoAuditoria(tx, objetivoId);
          const objetivo = await tx.objetivoAuditoria.findUniqueOrThrow({
            where: { id: objetivoId },
          });
          if (objetivo.envioResultadoId) {
            throw conflicto('Esta auditoria ya fue completada.');
          }

          const areaVigente = await tx.area.findUniqueOrThrow({
            where: { id: objetivo.areaId },
          });
          const versionFormulario = await obtenerVersionFormularioActivaPorTipoArea(
            tx,
            areaVigente.tipo,
          );

          validarCodigoArea(areaVigente.codigoVerificacion, areaTemp.codigoVerificacion);
          const preguntasEsperadas = versionFormulario.secciones.flatMap((s) => s.preguntas);
          validarRespuestas5S(preguntasEsperadas, respuestasPayload);
          const puntaje = calcularPuntaje5S(respuestasPayload);

          const creado = await tx.envioAuditoria.create({
            data: {
              identificadorCliente: idCliente,
              objetivoAuditoriaId: objetivo.id,
              enviadoPorUsuarioId: usuarioAuditor.id,
              nombreAuditorSnapshot: usuarioAuditor.nombre,
              origen: OrigenEnvioAuditoria.USUARIO,
              puntajeObtenido: puntaje.puntajeObtenido,
              puntajePosible: puntaje.puntajePosible,
              porcentaje: puntaje.porcentaje,
              realizadaATiempo: true,
              finalizadoEn: new Date(),
              verificadoEn: new Date(),
            },
          });

          for (const r of respuestasPayload) {
            await tx.respuestaAuditoria.create({
              data: {
                envioAuditoriaId: creado.id,
                preguntaFormularioId: r.preguntaFormularioId,
                cumple: r.cumple,
                hallazgo: r.hallazgo,
              },
            });
          }

          const oficial = await tx.objetivoAuditoria.updateMany({
            where: { id: objetivo.id, envioResultadoId: null, canceladoEn: null },
            data: {
              envioResultadoId: creado.id,
              versionFormularioId: versionFormulario.id,
              tipoAreaSnapshot: areaVigente.tipo,
              codigoAreaSnapshot: areaVigente.codigo,
              nombreAreaSnapshot: areaVigente.nombre,
            },
          });
          if (!oficial.count) throw conflicto('Esta auditoria ya fue completada.');
          return creado;
        });
      };

      // Función que ejecuta la lógica transaccional real de cambio de tipo de área
      const ejecutarTransaccionCambioTipoArea = async (nuevoTipo: TipoArea) => {
        return transaccionSerializable(async (tx) => {
          const actualizado = await tx.area.update({
            where: { id: areaTemp.id },
            data: { tipo: nuevoTipo },
          });
          return sincronizarObjetivosPendientesDeArea(tx, actualizado);
        });
      };

      // =========================================================================
      // ORDEN 1: El envío de evaluación (objOrden1) confirma ANTES del cambio de tipo de área
      // =========================================================================
      let liberarCambioTipoOrden1!: () => void;
      const barreraOrden1 = new Promise<void>((resolve) => {
        liberarCambioTipoOrden1 = resolve;
      });

      const promesaEnvioOrden1 = (async () => {
        const res = await ejecutarTransaccionEnvio(
          objOrden1.id,
          respuestasFormularioAdm,
          `conc-orden1-${sufijo}`,
        );
        liberarCambioTipoOrden1();
        return res;
      })();

      const promesaCambioOrden1 = (async () => {
        await barreraOrden1;
        return ejecutarTransaccionCambioTipoArea(TipoArea.OPERATIVA);
      })();

      const [envioOrden1, syncOrden1] = await Promise.all([
        promesaEnvioOrden1,
        promesaCambioOrden1,
      ]);

      expect(envioOrden1.id).toBeGreaterThan(0);
      // objOrden1 ya estaba completado cuando corrió el cambio de tipo, así que solo objOrden2 debió sincronizarse
      expect(syncOrden1.objetivosIds).toEqual([objOrden2.id]);

      const objOrden1Final = await prisma.objetivoAuditoria.findUniqueOrThrow({
        where: { id: objOrden1.id },
        include: {
          envioResultado: {
            include: {
              respuestasAuditoria: {
                include: {
                  preguntaFormulario: {
                    include: { seccionFormulario: true },
                  },
                },
              },
            },
          },
        },
      });

      // Verificación de invariante en Orden 1:
      // objOrden1 conserva su formulario ADMINISTRATIVO (versionAdm.id) y todas sus respuestas pertenecen a versionAdm.id
      expect(objOrden1Final.envioResultadoId).toBe(envioOrden1.id);
      expect(objOrden1Final.versionFormularioId).toBe(versionAdm.id);
      expect(objOrden1Final.tipoAreaSnapshot).toBe(TipoArea.ADMINISTRATIVA);
      for (const resp of objOrden1Final.envioResultado!.respuestasAuditoria) {
        expect(resp.preguntaFormulario.seccionFormulario.versionFormularioId).toBe(
          objOrden1Final.versionFormularioId,
        );
      }

      // =========================================================================
      // ORDEN 2: El cambio de tipo de área (a OPERATIVA) confirma ANTES del envío con respuestas ADMINISTRATIVAS (objOrden2)
      // =========================================================================
      // Nota: objOrden2 ya quedó actualizado a OPERATIVA (versionOp.id) tras syncOrden1.
      // Ahora el auditor que tenía abierto el formulario ADMINISTRATIVO intenta enviar respuestasFormularioAdm para objOrden2:
      await expect(
        ejecutarTransaccionEnvio(
          objOrden2.id,
          respuestasFormularioAdm,
          `conc-orden2-invalido-${sufijo}`,
        ),
      ).rejects.toThrow();

      const objOrden2TrasRechazo = await prisma.objetivoAuditoria.findUniqueOrThrow({
        where: { id: objOrden2.id },
        include: { enviosAuditoria: true },
      });

      // Verificación de invariante en Orden 2:
      // No se creó ningún EnvioAuditoria con respuestas administrativas y objOrden2 sigue pendiente con versionOp.id
      expect(objOrden2TrasRechazo.envioResultadoId).toBeNull();
      expect(objOrden2TrasRechazo.enviosAuditoria).toHaveLength(0);
      expect(objOrden2TrasRechazo.versionFormularioId).toBe(versionOp.id);
      expect(objOrden2TrasRechazo.tipoAreaSnapshot).toBe(TipoArea.OPERATIVA);
    } finally {
      // Limpieza total de registros temporales creados en encuestas_5s_test
      await prisma.respuestaAuditoria.deleteMany({
        where: { envioAuditoria: { objetivoAuditoria: { areaId: areaTemp.id } } },
      });
      await prisma.envioAuditoria.deleteMany({
        where: { objetivoAuditoria: { areaId: areaTemp.id } },
      });
      await prisma.objetivoAuditoria.deleteMany({
        where: { areaId: areaTemp.id },
      });
      await prisma.area.delete({
        where: { id: areaTemp.id },
      });
      if (idsFormulariosCreados.length > 0) {
        await prisma.preguntaFormulario.deleteMany({
          where: { seccionFormulario: { versionFormulario: { formularioId: { in: idsFormulariosCreados } } } },
        });
        await prisma.seccionFormulario.deleteMany({
          where: { versionFormulario: { formularioId: { in: idsFormulariosCreados } } },
        });
        await prisma.versionFormulario.deleteMany({
          where: { formularioId: { in: idsFormulariosCreados } },
        });
        await prisma.formulario.deleteMany({
          where: { id: { in: idsFormulariosCreados } },
        });
      }
      if (idUsuarioCreado) {
        await prisma.usuario.delete({ where: { id: idUsuarioCreado } });
      }
    }
  });

  test('6. Recuperación Frontend: conserva QR válido, hallazgos escritos, evidencias IndexedDB/Cloudinary, detiene reintentos 400/409 en cola offline y no traduce respuestas SI/NO', async () => {
    const store = new Map<string, string>();
    (globalThis as any).localStorage = {
      get length() {
        return store.size;
      },
      key(i: number) {
        return [...store.keys()][i] ?? null;
      },
      getItem(k: string) {
        return store.get(k) ?? null;
      },
      setItem(k: string, v: string) {
        store.set(k, String(v));
      },
      removeItem(k: string) {
        store.delete(k);
      },
      clear() {
        store.clear();
      },
    };

    const rutaColaFrontend = '../../../frontend/src/features/auditorias/ejecucion/utils/auditoria-cola-pendiente.js';
    const {
      encolarAuditoriaPendiente,
      obtenerPendienteDeAsignacion,
      esErrorIncompatibilidadFormulario,
      marcarConflictoFormularioEnCola,
      buscarBorradoresVersionAnterior,
      extraerDatosRecuperables,
    } = (await import(rutaColaFrontend)) as any;

    // 1. Simular borrador previo guardado con versionFormularioId = 2 (ADMINISTRATIVO)
    const draftAnteriorKey = 'encuestas-5s:auditoria-draft:autenticado:777:2';
    store.set(
      draftAnteriorKey,
      JSON.stringify({
        versionFormularioId: 2,
        identificadorCliente: 'uuid-draft-adm',
        verificacionArea: {
          codigoQr: 'CELULA-76',
          verificado: true,
          verificadoEn: '2026-03-18T10:00:00.000Z',
        },
        respuestas: {
          '2001': {
            opcionFormularioIds: [1],
            cumple: true,
            hallazgo: null,
            evidencias: [],
          },
          '2002': {
            opcionFormularioIds: [2],
            cumple: false,
            hallazgo: 'Cables sueltos bajo la mesa de trabajo',
            evidencias: [
              {
                identificadorCliente: 'ev-cloud-1',
                publicIdCloudinary: '5s/evidencias/ev-cloud-1',
                formato: 'jpg',
              },
            ],
          },
        },
        updatedAt: '2026-03-18T10:05:00.000Z',
      }),
    );

    // 2. Simular evidencia adicional aún en IndexedDB (sin subir a Cloudinary)
    const evidenciasDexieMock = [
      {
        id: 1,
        auditoriaId: '777',
        criterioId: '2002',
        identificadorCliente: 'ev-dexie-local-2',
        fileName: 'foto_pasillo.jpg',
        fileType: 'image/jpeg',
        fileBlob: new Uint8Array([1, 2, 3]),
      },
    ];

    // 3. Simular envío en cola offline con respuestas de la versión 2 (ADMINISTRATIVO)
    encolarAuditoriaPendiente({
      id: 'envio-cola-777',
      asignacionId: 777,
      modo: 'autenticado',
      token: null,
      versionFormularioId: 2,
      payload: {
        identificadorCliente: 'envio-cola-777',
        asignacionAuditoriaId: 777,
        codigoVerificacion: 'CELULA-76',
        respuestas: [
          {
            preguntaFormularioId: 2001,
            cumple: true,
            hallazgo: null,
            fotos: [],
          },
          {
            preguntaFormularioId: 2002,
            cumple: false,
            hallazgo: 'Cables sueltos bajo la mesa de trabajo',
            fotos: [
              {
                identificadorCliente: 'ev-cloud-1',
                publicIdCloudinary: '5s/evidencias/ev-cloud-1',
              },
            ],
          },
        ],
      },
    });

    // 4. Al recibir error 400/409 de incompatibilidad de formulario, debe detectarse y detener reintentos infinitos
    expect(
      esErrorIncompatibilidadFormulario({
        status: 400,
        message: 'Una respuesta no pertenece a la version del formulario de este objetivo',
      }),
    ).toBe(true);
    expect(
      esErrorIncompatibilidadFormulario({
        status: 409,
        message: 'El formulario asignado al área fue actualizado por un cambio de clasificación',
      }),
    ).toBe(true);

    const entradaMarcada = marcarConflictoFormularioEnCola(
      'envio-cola-777',
      'Una respuesta no pertenece a la version del formulario de este objetivo',
      400,
    );
    expect(entradaMarcada?.conflictoFormulario).toBe(true);
    expect(entradaMarcada?.requiereRevision).toBe(true);
    expect(entradaMarcada?.detenerReintentoAutomatico).toBe(true);
    expect(obtenerPendienteDeAsignacion(777)?.detenerReintentoAutomatico).toBe(true);

    // 5. Al abrir la evaluación con la nueva versión activa = 1 (OPERATIVO):
    //    - Encuentra el borrador anterior sin borrarlo
    //    - Recupera la verificación QR válida
    //    - Recupera el hallazgo escrito
    //    - Recupera tanto la evidencia en Cloudinary como la evidencia en IndexedDB
    //    - NO traduce respuestas SI/NO automáticamente
    const borradoresAnteriores = buscarBorradoresVersionAnterior('autenticado', 777, 1);
    expect(borradoresAnteriores).toHaveLength(1);
    expect(store.has(draftAnteriorKey)).toBe(true); // El borrador anterior NO se borra

    const recuperado = extraerDatosRecuperables({
      borradoresAnteriores,
      entradaColaConflicto: entradaMarcada,
      evidenciasDexie: evidenciasDexieMock,
      codigoVerificacionEsperado: 'CELULA-76',
    });

    expect(recuperado.tieneDatosRecuperables).toBe(true);
    expect(recuperado.verificacionQrRecuperada?.verificado).toBe(true);
    expect(recuperado.verificacionQrRecuperada?.codigoQr).toBe('CELULA-76');
    expect(recuperado.hallazgosRecuperados).toHaveLength(1);
    expect(recuperado.hallazgosRecuperados[0].hallazgo).toBe('Cables sueltos bajo la mesa de trabajo');
    expect(recuperado.evidenciasRecuperadas).toHaveLength(2);
    expect(
      recuperado.evidenciasRecuperadas.map((e: any) => e.identificadorCliente).sort(),
    ).toEqual(['ev-cloud-1', 'ev-dexie-local-2']);
  });
});
