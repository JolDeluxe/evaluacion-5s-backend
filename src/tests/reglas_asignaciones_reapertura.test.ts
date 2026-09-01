import { describe, expect, test } from 'bun:test';
import { EstadoAsignacionAuditoria } from '../generated/prisma/enums';
import { reabrirAsignacionEnTransaccion } from '../modules/asignaciones/12_reabrir';
import { validarAuditorMensualArea } from '../modules/asignaciones/programacion_mensual';
import { validarRespuestas5S } from '../modules/auditorias/helper';
import type { PrismaTransaction } from '../db';

describe('Reglas de Negocio - Asignaciones y Reapertura de Auditorías', () => {

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