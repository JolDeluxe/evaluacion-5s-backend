/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, test } from 'bun:test';
import { EstadoAsignacionAuditoria } from '../generated/prisma/enums';
import { reabrirAsignacionEnTransaccion } from '../modules/asignaciones/12_reabrir';
import { validarAuditorMensualArea } from '../modules/asignaciones/programacion_mensual';
import { validarRespuestas5S } from '../modules/auditorias/helper';
import type { PrismaTransaction } from '../db';
import { clasificarAsignacionParaReasignacion, obtenerAuditorAnterior, obtenerPendientesGlobalesDeAsignacion } from '../modules/asignaciones/servicio_reasignacion';
import { areaEsAuditableEnPeriodo } from '../modules/areas/servicio_vigencia_area';
import { esquemaConfirmarAutoasignacion } from '../modules/asignaciones/zod';
import {
  aplicarResolucionesResponsabilidadUsuario,
  validarCruceResponsablesAuditores,
  validarSnapshotAsignaciones,
} from '../modules/usuarios/servicio_impacto_usuario';

describe('Reglas de Negocio - Asignaciones y Reapertura de Auditorías', () => {

  test('clasifica completadas, vencidas, en gracia y reabiertas sin mezclar el historial', () => {
    const ahora = new Date();
    const objetivo = (terminaEn: Date, envioResultado: Record<string, unknown> | null = null) => ({
      id: 1, areaId: 1, anio: ahora.getFullYear(), mes: ahora.getMonth() + 1, periodo: 1,
      iniciaEn: new Date(ahora.getTime() - 86_400_000), terminaEn, envioResultado, enviosAuditoria: [],
    });
    const base = { estado: EstadoAsignacionAuditoria.PENDIENTE, completadoEn: null, reabiertaHasta: null };
    expect(clasificarAsignacionParaReasignacion(objetivo(new Date(ahora.getTime() + 86_400_000)) as any, base).categoria).toBe('REASIGNABLE');
    expect(clasificarAsignacionParaReasignacion(objetivo(new Date(ahora.getTime() - 86_400_000)) as any, base).categoria).toBe('REASIGNABLE');
    expect(clasificarAsignacionParaReasignacion(objetivo(new Date(ahora.getTime() - 40 * 86_400_000)) as any, base).categoria).toBe('VENCIDA');
    expect(clasificarAsignacionParaReasignacion(objetivo(new Date(ahora.getTime() - 40 * 86_400_000)) as any, { ...base, reabiertaHasta: new Date(ahora.getTime() + 86_400_000) }).categoria).toBe('REASIGNABLE');
    expect(clasificarAsignacionParaReasignacion(objetivo(new Date(ahora.getTime() - 86_400_000), { id: 3, verificadoEn: ahora, invalidadoEn: null, porcentaje: 100 }) as any, base).categoria).toBe('COMPLETADA');
  });

  test('consulta global encuentra solo objetivos existentes, realizables y sin auditor válido', async () => {
    const ahora = new Date();
    const area = { id: 1, codigo: 'A1', nombre: 'Contabilidad', tipo: 'ADMINISTRATIVA', activo: true, auditableDesde: null, auditableHasta: null };
    const objetivo = (id: number, terminaEn: Date, asignacionesAuditoria: any[] = [], envioResultado: Record<string, unknown> | null = null) => ({
      id, areaId: 1, anio: ahora.getFullYear(), mes: ahora.getMonth() + 1, periodo: id,
      iniciaEn: new Date(ahora.getTime() - 86_400_000), terminaEn, area, envioResultado, enviosAuditoria: [], asignacionesAuditoria,
    });
    const auditorInactivo = { id: 10, nombre: 'Daniel', nombreUsuario: 'daniel', activo: false, rol: 'AUDITOR' };
    const auditorActivo = { id: 11, nombre: 'Patricia', nombreUsuario: 'patricia', activo: true, rol: 'AUDITOR' };
    const asignacion = (id: number, auditor: any, estado: EstadoAsignacionAuditoria = EstadoAsignacionAuditoria.PENDIENTE, reabiertaHasta: Date | null = null) => ({ id, auditor, estado, completadoEn: null, reabiertaHasta, actualizadoEn: new Date(), motivoCancelacion: null });
    const resultados = await obtenerPendientesGlobalesDeAsignacion({
      objetivoAuditoria: {
        findMany: async () => [
          objetivo(1, new Date(ahora.getTime() + 86_400_000)),
          objetivo(2, new Date(ahora.getTime() - 86_400_000), [asignacion(2, auditorInactivo)]),
          objetivo(3, new Date(ahora.getTime() - 40 * 86_400_000), [asignacion(3, auditorInactivo, EstadoAsignacionAuditoria.VENCIDA, new Date(ahora.getTime() + 86_400_000))]),
          objetivo(4, new Date(ahora.getTime() - 40 * 86_400_000)),
          objetivo(5, new Date(ahora.getTime() + 86_400_000), [asignacion(5, auditorActivo)]),
          objetivo(6, new Date(ahora.getTime() + 86_400_000), [], { id: 9, verificadoEn: ahora, invalidadoEn: null, porcentaje: 100 }),
        ],
      },
    } as unknown as PrismaTransaction);
    expect(resultados.map((item) => item.objetivoAuditoriaId)).toEqual([1, 2, 3]);
  });

  test('elige el auditor cancelado más reciente y rechaza duplicados al confirmar', () => {
    const anterior = obtenerAuditorAnterior([
      { estado: EstadoAsignacionAuditoria.CANCELADA, actualizadoEn: new Date(2026, 0, 1), id: 1 },
      { estado: EstadoAsignacionAuditoria.CANCELADA, actualizadoEn: new Date(2026, 1, 1), id: 2 },
    ]);
    expect(anterior?.id).toBe(2);
    expect(() => esquemaConfirmarAutoasignacion.parse({ anio: 2026, mes: 9, asignaciones: [{ areaId: 1, auditorId: 2 }, { areaId: 1, auditorId: 3 }] })).toThrow();
  });

  test('la vigencia respeta bajas este mes, próximo mes y el cruce de año', () => {
    const activa = { activo: true, auditableDesde: null, auditableHasta: new Date(2026, 8, 30) };
    expect(areaEsAuditableEnPeriodo(activa, 2026, 9, 30)).toBe(true);
    expect(areaEsAuditableEnPeriodo(activa, 2026, 10, 15)).toBe(false);
    expect(areaEsAuditableEnPeriodo({ ...activa, activo: false }, 2026, 9, 15)).toBe(true);
    expect(areaEsAuditableEnPeriodo({ ...activa, auditableHasta: new Date(2026, 11, 31) }, 2027, 1, 15)).toBe(false);
  });

  test('la resolución de baja impide elegir a la misma persona como responsable y auditor del área', () => {
    expect(() => validarCruceResponsablesAuditores(
      [{ relacionId: 1, areaId: 5, accion: 'REEMPLAZAR', nuevoResponsableId: 20 }],
      [{ clave: '5:2026:9', asignacionIds: [1], accion: 'REASIGNAR', nuevoAuditorId: 20 }],
    )).toThrow('responsable y auditor');

    expect(() => validarCruceResponsablesAuditores(
      [{ relacionId: 1, areaId: 5, accion: 'SIN_REEMPLAZO', nuevoResponsableId: null }],
      [{ clave: '5:2026:9', asignacionIds: [1], accion: 'REASIGNAR', nuevoAuditorId: 20 }],
    )).not.toThrow();
  });

  test('la confirmación detecta asignaciones cambiadas por otro administrador', () => {
    expect(() => validarSnapshotAsignaciones([10, 11], [10, 11])).not.toThrow();
    expect(() => validarSnapshotAsignaciones([10, 12], [10, 11])).toThrow('No se sobrescribió ningún cambio');
  });

  test('la baja permite retirar al único responsable sin reemplazo', async () => {
    const eliminadas: number[] = [];
    const tx = {
      usuarioArea: {
        delete: async ({ where }: any) => {
          eliminadas.push(where.id);
          return { id: where.id };
        },
        upsert: async () => ({}),
      },
      registroAuditoria: { create: async () => ({}) },
    } as unknown as PrismaTransaction;
    const impacto = {
      responsabilidades: [{ relacionId: 7, area: { id: 5 }, candidatos: [] }],
    } as any;

    const resultado = await aplicarResolucionesResponsabilidadUsuario(
      tx,
      10,
      [{ relacionId: 7, areaId: 5, accion: 'SIN_REEMPLAZO', nuevoResponsableId: null }],
      impacto,
      1,
    );

    expect(eliminadas).toEqual([7]);
    expect(resultado).toEqual({ reemplazadas: 0, sinReemplazo: 1 });
  });

  test('la baja puede reemplazar una responsabilidad y elimina la relación anterior', async () => {
    const operaciones: string[] = [];
    const tx = {
      usuarioArea: {
        upsert: async ({ create }: any) => {
          operaciones.push(`crear:${create.usuarioId}:${create.areaId}`);
          return create;
        },
        delete: async ({ where }: any) => {
          operaciones.push(`eliminar:${where.id}`);
          return { id: where.id };
        },
      },
      registroAuditoria: { create: async () => ({}) },
    } as unknown as PrismaTransaction;
    const impacto = {
      responsabilidades: [{ relacionId: 7, area: { id: 5 }, candidatos: [{ id: 20 }] }],
    } as any;

    const resultado = await aplicarResolucionesResponsabilidadUsuario(
      tx,
      10,
      [{ relacionId: 7, areaId: 5, accion: 'REEMPLAZAR', nuevoResponsableId: 20 }],
      impacto,
      1,
    );

    expect(operaciones).toEqual(['crear:20:5', 'eliminar:7']);
    expect(resultado).toEqual({ reemplazadas: 1, sinReemplazo: 0 });
  });

  test('1. P1 vencida + P2 realizada (Juan) -> reabrir P1 con Pedro asigna Pedro a P1 y respeta Juan en P2', async () => {
    const asignacionP1 = {
      id: 1,
      auditorId: 10, // Juan
      estado: EstadoAsignacionAuditoria.PENDIENTE,
      objetivoAuditoriaId: 100,
      objetivoAuditoria: {
        id: 100,
        areaId: 5,
        anio: 2026,
        mes: 8,
        periodo: 1,
        iniciaEn: new Date(2026, 7, 1),
        terminaEn: new Date(2026, 7, 15),
        envioResultado: null,
        enviosAuditoria: [],
      },
    };

    const objetivoP2 = {
      id: 101,
      areaId: 5,
      anio: 2026,
      mes: 8,
      periodo: 2,
      iniciaEn: new Date(2026, 7, 16),
      terminaEn: new Date(2026, 7, 31),
      envioResultado: { id: 999 }, // Ya realizada
      enviosAuditoria: [{ id: 999 }],
      asignacionesAuditoria: [{ id: 2, auditorId: 10, estado: EstadoAsignacionAuditoria.COMPLETADA }],
    };

    const objetivoP1Vencido = {
      ...asignacionP1.objetivoAuditoria,
      asignacionesAuditoria: [asignacionP1],
    };

    // Mock transaction context
    const asignacionMensualActualizada = { auditorId: 0 };
    const asignacionP1Actualizada = { auditorId: 0, estado: '', reabiertaHasta: new Date() };

    const mockTx = {
      asignacionAuditoria: {
        findUniqueOrThrow: async () => asignacionP1,
        update: async (args: { data: Record<string, unknown> }) => {
          Object.assign(asignacionP1Actualizada, args.data);
          return { ...asignacionP1, ...args.data };
        },
      },
      objetivoAuditoria: {
        findMany: async () => [objetivoP1Vencido, objetivoP2],
      },
      usuarioArea: {
        findFirst: async () => null, // No es responsable de su propia área
      },
      asignacionMensual: {
        upsert: async (args: { create: Record<string, unknown> }) => {
          Object.assign(asignacionMensualActualizada, args.create);
          return { id: 50, ...args.create };
        },
        findUniqueOrThrow: async () => ({ id: 50 }),
      },
      registroAuditoria: {
        create: async () => ({}),
      },
    } as unknown as PrismaTransaction;

    // Ejecutar reapertura de P1 con Pedro (ID 20)
    await reabrirAsignacionEnTransaccion(mockTx, 1, { motivo: 'Fuerza mayor', auditorMensualId: 20 }, 1);

    // AsignacionMensual debe cambiar a Pedro (20)
    expect(asignacionMensualActualizada.auditorId).toBe(20);

    // P1 debe quedar asignado a Pedro (20)
    expect(asignacionP1Actualizada.auditorId).toBe(20);
    expect(asignacionP1Actualizada.estado).toBe(EstadoAsignacionAuditoria.PENDIENTE);
    expect(asignacionP1Actualizada.reabiertaHasta).toBeDefined();

    // P2 realizada se mantiene con Juan (10) e inmutable
    expect(objetivoP2.asignacionesAuditoria[0].auditorId).toBe(10);
  });

  test('reabrir P1 vencido SIN AsignacionAuditoria previa crea la primera asignación con el auditor mensual', async () => {
    const objetivoP1SinAsig = {
      id: 300,
      areaId: 10,
      anio: 2026,
      mes: 8,
      periodo: 1,
      iniciaEn: new Date(2026, 7, 1),
      terminaEn: new Date(2026, 7, 15),
      envioResultado: null,
      enviosAuditoria: [],
      asignacionesAuditoria: [],
    };

    let asignacionCreada: any = null;

    const mockTx = {
      asignacionAuditoria: {
        findUnique: async () => null,
        create: async (args: any) => {
          asignacionCreada = args.data;
          return { id: 888, ...args.data, auditor: { id: 11, nombre: 'Fernando Castro' } };
        },
        update: async () => ({}),
      },
      objetivoAuditoria: {
        findUniqueOrThrow: async () => objetivoP1SinAsig,
      },
      asignacionMensual: {
        findUnique: async () => ({ id: 2, auditorId: 11, auditor: { id: 11, nombre: 'Fernando Castro' } }),
      },
      registroAuditoria: { create: async () => ({}) },
    } as unknown as PrismaTransaction;

    const res = await reabrirAsignacionEnTransaccion(
      mockTx,
      null,
      { motivo: 'Apertura extemporánea', objetivoAuditoriaId: 300 },
      1,
    );

    expect(res.id).toBe(888);
    expect(asignacionCreada.auditorId).toBe(11);
    expect(asignacionCreada.objetivoAuditoriaId).toBe(300);
    expect(asignacionCreada.estado).toBe(EstadoAsignacionAuditoria.PENDIENTE);
  });

  test('reabrir P1 vencido sin AsignacionMensual lanza error claro exigiendo asignar auditor mensual', async () => {
    const objetivoP1SinAsig = {
      id: 301,
      areaId: 10,
      anio: 2026,
      mes: 8,
      periodo: 1,
      iniciaEn: new Date(2026, 7, 1),
      terminaEn: new Date(2026, 7, 15),
      envioResultado: null,
      enviosAuditoria: [],
      asignacionesAuditoria: [],
    };

    const mockTx = {
      asignacionAuditoria: { findUnique: async () => null },
      objetivoAuditoria: { findUniqueOrThrow: async () => objetivoP1SinAsig },
      asignacionMensual: { findUnique: async () => null },
    } as unknown as PrismaTransaction;

    expect(reabrirAsignacionEnTransaccion(
      mockTx,
      null,
      { motivo: 'Intentar sin mensual', objetivoAuditoriaId: 301 },
      1,
    )).rejects.toThrow('primero necesitas asignar un auditor mensual');
  });

  test('2. P1 vencida + P2 pendiente (Juan) -> reabrir P1 con Pedro actualiza P1 y P2 a Pedro', async () => {
    const asignacionP1 = {
      id: 1,
      auditorId: 10, // Juan
      estado: EstadoAsignacionAuditoria.PENDIENTE,
      objetivoAuditoriaId: 100,
      objetivoAuditoria: {
        id: 100,
        areaId: 5,
        anio: 2026,
        mes: 8,
        periodo: 1,
        iniciaEn: new Date(2026, 7, 1),
        terminaEn: new Date(2026, 7, 15),
        envioResultado: null,
        enviosAuditoria: [],
      },
    };

    const asignacionP2 = {
      id: 2,
      auditorId: 10,
      estado: EstadoAsignacionAuditoria.PENDIENTE,
      venceEn: new Date(2026, 7, 31),
    };

    const objetivoP2 = {
      id: 101,
      areaId: 5,
      anio: 2026,
      mes: 8,
      periodo: 2,
      iniciaEn: new Date(2026, 7, 16),
      terminaEn: new Date(2026, 7, 31),
      envioResultado: null,
      enviosAuditoria: [],
      asignacionesAuditoria: [asignacionP2],
    };

    const objetivoP1Vencido = {
      ...asignacionP1.objetivoAuditoria,
      asignacionesAuditoria: [asignacionP1],
    };

    const actualizadasP2: Record<string, unknown>[] = [];
    const mockTx = {
      asignacionAuditoria: {
        findUniqueOrThrow: async () => asignacionP1,
        update: async (args: { where: { id: number }; data: Record<string, unknown> }) => {
          if (args.where.id === 2) actualizadasP2.push(args.data);
          return { ...asignacionP1, ...args.data };
        },
        create: async (args: { data: Record<string, unknown> }) => ({ id: 99, ...args.data }),
      },
      objetivoAuditoria: {
        findMany: async () => [objetivoP1Vencido, objetivoP2],
        findUniqueOrThrow: async () => ({ id: 100, areaId: 5, nombreAreaSnapshot: 'AVIO' }),
      },
      usuarioArea: {
        findFirst: async () => null,
      },
      usuario: {
        findUnique: async () => ({ id: 20, activo: true, rol: 'AUDITOR' }),
        findUniqueOrThrow: async () => ({ id: 20, activo: true, rol: 'AUDITOR' }),
      },
      asignacionMensual: {
        upsert: async (args: { create: Record<string, unknown> }) => ({ id: 50, ...args.create }),
        findUniqueOrThrow: async () => ({ id: 50 }),
      },
      enlaceInvitado: {
        updateMany: async () => ({ count: 0 }),
      },
      registroAuditoria: {
        create: async () => ({}),
      },
    } as unknown as PrismaTransaction;

    await reabrirAsignacionEnTransaccion(mockTx, 1, { motivo: 'Reapertura general', auditorMensualId: 20 }, 1);

    // P2 (que estaba pendiente) también se actualiza para apuntar al nuevo auditor mensual Pedro
    expect(actualizadasP2.length).toBeGreaterThan(0);
  });

  test('3. Un periodo completado con EnvioAuditoria jamás permite cambiar auditor', async () => {
    const asignacionCompletada = {
      id: 1,
      auditorId: 10,
      estado: EstadoAsignacionAuditoria.COMPLETADA,
      objetivoAuditoriaId: 100,
      objetivoAuditoria: {
        id: 100,
        areaId: 5,
        anio: 2026,
        mes: 8,
        periodo: 1,
        iniciaEn: new Date(2026, 7, 1),
        terminaEn: new Date(2026, 7, 15),
        envioResultado: { id: 55 },
        enviosAuditoria: [{ id: 55 }],
      },
    };

    const mockTx = {
      asignacionAuditoria: {
        findUniqueOrThrow: async () => asignacionCompletada,
      },
    } as unknown as PrismaTransaction;

    expect(reabrirAsignacionEnTransaccion(mockTx, 1, { motivo: 'Intento invalido' }, 1))
      .rejects.toThrow('La auditoria ya fue realizada');
  });

  test('4. Reapertura exige motivo de texto válido', async () => {
    const mockTx = {} as unknown as PrismaTransaction;
    // La validación Zod previene motivos vacíos
    expect(reabrirAsignacionEnTransaccion(mockTx, 1, { motivo: '' }, 1))
      .rejects.toThrow();
  });

  test('5. Auditor no puede ser responsable de su propia área', async () => {
    const mockTx = {
      usuarioArea: {
        findFirst: async () => ({ id: 99 }), // Es responsable del área
      },
    } as unknown as PrismaTransaction;

    expect(validarAuditorMensualArea(mockTx, 5, 20))
      .rejects.toThrow('El auditor no puede auditar su propia area');
  });

  test('6. Propuesta de autoasignación calcula sin guardar en BD', async () => {
    const mockTx = {
      objetivoAuditoria: {
        findMany: async () => [
          {
            id: 1,
            areaId: 10,
            anio: 2026,
            mes: 9,
            periodo: 1,
            iniciaEn: new Date(),
            terminaEn: new Date(),
            area: { id: 10, codigo: 'A1', nombre: 'AVIO', tipo: 'OPERATIVA', usuariosArea: [] },
            envioResultado: null,
            enviosAuditoria: [],
            asignacionesAuditoria: [],
          },
        ],
      },
      usuario: {
        findMany: async () => [{ id: 15, nombre: 'Andrea', nombreUsuario: 'andrea', rol: 'AUDITOR' }],
      },
      asignacionMensual: {
        findMany: async () => [],
      },
    } as unknown as PrismaTransaction;

    const { calcularPropuestaAutoasignacion } = await import('../modules/asignaciones/programacion_mensual');
    const propuesta = await calcularPropuestaAutoasignacion(mockTx, 2026, 9);

    expect(propuestasMatch(propuesta)).toBe(true);
    expect(propuesta.propuestas[0].auditor?.id).toBe(15);
  });

  test('7. Pruebas de disponibilidad y urgencia de fechas (obtenerEstadoEjecucion)', async () => {
    const { obtenerEstadoEjecucion } = await import('../modules/asignaciones/01_listar');

    const baseAsig = {
      estado: EstadoAsignacionAuditoria.PENDIENTE,
      reabiertaHasta: null,
      objetivoAuditoria: {
        iniciaEn: new Date(2026, 7, 1),
        terminaEn: new Date(2026, 7, 15),
      },
    };

    // a. Día anterior al cierre normal -> Disponible (verde)
    const ago14 = new Date(2026, 7, 14, 12, 0, 0);
    const estadoAgo14 = obtenerEstadoEjecucion(baseAsig, ago14);
    expect(estadoAgo14.texto).toBe('Disponible');
    expect(estadoAgo14.color).toBe('verde');
    expect(estadoAgo14.realizable).toBe(true);

    // b. Hoy es terminaEn (15 de agosto) -> ÚLTIMO DÍA PARA REALIZAR (rojo)
    const ago15 = new Date(2026, 7, 15, 10, 0, 0);
    const estadoAgo15 = obtenerEstadoEjecucion(baseAsig, ago15);
    expect(estadoAgo15.texto).toBe('ÚLTIMO DÍA PARA REALIZAR');
    expect(estadoAgo15.color).toBe('rojo');
    expect(estadoAgo15.realizable).toBe(true);

    // c. Transcurrida la fecha normal (16 de agosto), en ventana tardía -> ATRASADA (rojo y ejecutable)
    const ago16 = new Date(2026, 7, 16, 10, 0, 0);
    const estadoAgo16 = obtenerEstadoEjecucion(baseAsig, ago16);
    expect(estadoAgo16.texto).toBe('ATRASADA');
    expect(estadoAgo16.color).toBe('rojo');
    expect(estadoAgo16.realizable).toBe(true);

    // d. Reabierta hasta 7 sep -> REABIERTA · VENCIDA
    const asigReabierta = {
      ...baseAsig,
      reabiertaHasta: new Date(2026, 8, 7),
    };
    const sep1 = new Date(2026, 8, 1, 10, 0, 0);
    const estadoReabierta = obtenerEstadoEjecucion(asigReabierta, sep1);
    expect(estadoReabierta.texto).toBe('REABIERTA · VENCIDA');
    expect(estadoReabierta.realizable).toBe(true);

    // f. Hoy es antes de iniciaEn (ej: 1 sep para un periodo que inicia 16 sep) -> Aún no inicia
    const asigFutura = {
      ...baseAsig,
      objetivoAuditoria: {
        iniciaEn: new Date(2026, 8, 16),
        terminaEn: new Date(2026, 8, 30),
      },
    };
    const estadoFuturo = obtenerEstadoEjecucion(asigFutura, sep1);
    expect(estadoFuturo.texto).toBe('Aún no inicia');
    expect(estadoFuturo.realizable).toBe(false);

    // g. Cierre definitivo transcurrido sin envío (ej: 1 sep para periodo finalizado en julio) -> CERRADA / NO_REALIZADA
    const asigPasada = {
      ...baseAsig,
      objetivoAuditoria: {
        iniciaEn: new Date(2026, 6, 1),
        terminaEn: new Date(2026, 6, 15),
      },
    };
    const estadoPasado = obtenerEstadoEjecucion(asigPasada, sep1);
    expect(estadoPasado.status).toBe('CERRADA');
    expect(estadoPasado.realizable).toBe(false);
  });

  describe('Validación backend de respuestas de auditoría (validarRespuestas5S con requiereHallazgo)', () => {

    test('Caso 1: pregunta requiereHallazgo=true y respuesta NO sin hallazgo -> backend rechaza', () => {
      const preguntas = [{ id: 1, requiereHallazgo: true }];
      const respuestas = [{ preguntaFormularioId: 1, cumple: false, hallazgo: '' }];
      expect(() => validarRespuestas5S(preguntas, respuestas)).toThrow('El hallazgo es obligatorio cuando la respuesta es NO');
    });

    test('Caso 2: pregunta requiereHallazgo=true y respuesta NO con hallazgo -> backend acepta', () => {
      const preguntas = [{ id: 1, requiereHallazgo: true }];
      const respuestas = [{ preguntaFormularioId: 1, cumple: false, hallazgo: 'Falta limpieza en anaquel' }];
      expect(() => validarRespuestas5S(preguntas, respuestas)).not.toThrow();
    });

    test('Caso 3: pregunta requiereHallazgo=false y respuesta NO sin hallazgo -> backend acepta', () => {
      const preguntas = [{ id: 1, requiereHallazgo: false }];
      const respuestas = [{ preguntaFormularioId: 1, cumple: false, hallazgo: '' }];
      expect(() => validarRespuestas5S(preguntas, respuestas)).not.toThrow();
    });

    test('Caso 4: pregunta requiereHallazgo=false y respuesta SÍ -> backend acepta', () => {
      const preguntas = [{ id: 1, requiereHallazgo: false }];
      const respuestas = [{ preguntaFormularioId: 1, cumple: true, hallazgo: null }];
      expect(() => validarRespuestas5S(preguntas, respuestas)).not.toThrow();
    });
  });
});

function propuestasMatch(propuesta: { propuestas: Array<unknown>; sinCandidato: Array<unknown> }) {
  return propuesta.propuestas.length === 1 && propuesta.sinCandidato.length === 0;
}
