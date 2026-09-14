import { describe, expect, test } from 'bun:test';
import {
  calcularKpiFinal,
  determinarEstadoChip,
  calcularResultadoMensualCanonico,
  calcularYGuardarCumplimientoUsuario,
} from '../modules/cumplimientos/servicio_kpi';
import { resolverResponsableCumplimiento } from '../modules/asignaciones/programacion_mensual';
import { esDiaHabil } from '../utils/periodos';
import { TipoArea } from '../generated/prisma/enums';
import type { PrismaTransaction } from '../db';

describe('Cumplimientos, KPI 50/50, Delegaciones y Días Inhábiles', () => {
  describe('Algoritmo KPI 50/50 y Filosofía null vs 0', () => {
    test('Ambos componentes con datos reales -> promedio aritmético (50/50)', () => {
      // Cumplimiento 100%, Áreas 80% -> KPI 90%
      expect(calcularKpiFinal(100, 80)).toBe(90);

      // Cumplimiento 50%, Áreas 95.5% -> KPI 72.75%
      expect(calcularKpiFinal(50, 95.5)).toBe(72.75);
    });

    test('Incumplimiento real en auditorías (0%) promedia como 0% con áreas', () => {
      // Cumplimiento 0% (tenía asignaciones y no hizo ninguna), Áreas 100% -> KPI 50%
      expect(calcularKpiFinal(0, 100)).toBe(50);
    });

    test('Calificación real de 0% en áreas a cargo promedia como 0% con cumplimiento', () => {
      // Cumplimiento 100%, Áreas 0% -> KPI 50%
      expect(calcularKpiFinal(100, 0)).toBe(50);
    });

    test('Usuario sin auditorías esperadas (null) -> el promedio de áreas ocupa el 100%', () => {
      expect(calcularKpiFinal(null, 92.4)).toBe(92.4);
    });

    test('Usuario sin áreas evaluadas (null) -> el cumplimiento ocupa el 100%', () => {
      expect(calcularKpiFinal(85, null)).toBe(85);
    });

    test('Ambos componentes null -> KPI final es null (N/A absoluto)', () => {
      expect(calcularKpiFinal(null, null)).toBeNull();
    });
  });

  describe('Determinación de Chips de Estatus de Periodo (determinarEstadoChip)', () => {
    const terminaEn = new Date('2026-09-15T23:59:59Z');

    test('Envío realizado a tiempo -> A_TIEMPO', () => {
      const chip = determinarEstadoChip(
        { terminaEn, envioResultadoId: 10 },
        { realizadaATiempo: true, invalidadoEn: null },
      );
      expect(chip).toBe('A_TIEMPO');
    });

    test('Envío realizado tarde -> TARDE', () => {
      const chip = determinarEstadoChip(
        { terminaEn, envioResultadoId: 11 },
        { realizadaATiempo: false, invalidadoEn: null },
      );
      expect(chip).toBe('TARDE');
    });

    test('Periodo no vencido sin envío -> PENDIENTE', () => {
      const fechaPresente = new Date('2026-09-10T12:00:00Z');
      const chip = determinarEstadoChip(
        { terminaEn, envioResultadoId: null },
        null,
        fechaPresente,
      );
      expect(chip).toBe('PENDIENTE');
    });

    test('Periodo vencido sin envío habiendo expirado la gracia -> NO_REALIZADA', () => {
      const fechaFutura = new Date('2026-09-25T12:00:00Z'); // Después del 15 + gracia
      const chip = determinarEstadoChip(
        { terminaEn, envioResultadoId: null },
        null,
        fechaFutura,
      );
      expect(chip).toBe('NO_REALIZADA');
    });
  });

  describe('Resolución de Delegaciones y Responsable de Cumplimiento', () => {
    test('Caso 1: Auditor sin delegaciones activas -> el auditor es el responsable', async () => {
      const fakeTx = {
        delegacionCumplimiento: {
          findMany: async () => [],
        },
      } as unknown as PrismaTransaction;

      const responsableId = await resolverResponsableCumplimiento(fakeTx, 10, 2026, 9);
      expect(responsableId).toBe(10);
    });

    test('Caso 2: Auditor con 1 sola delegación activa -> el responsable delegado se asigna automáticamente', async () => {
      const fakeTx = {
        delegacionCumplimiento: {
          findMany: async () => [
            { id: 1, responsableId: 99 },
          ],
        },
      } as unknown as PrismaTransaction;

      const responsableId = await resolverResponsableCumplimiento(fakeTx, 10, 2026, 9);
      expect(responsableId).toBe(99);
    });

    test('Caso 3: Auditor con múltiples delegaciones activas -> si no especifica responsable lanza error', async () => {
      const fakeTx = {
        delegacionCumplimiento: {
          findMany: async () => [
            { id: 1, responsableId: 99 },
            { id: 2, responsableId: 88 },
          ],
        },
      } as unknown as PrismaTransaction;

      await expect(resolverResponsableCumplimiento(fakeTx, 10, 2026, 9))
        .rejects.toThrow('múltiples delegaciones');
    });

    test('Caso 3b: Auditor con múltiples delegaciones activas -> si especifica un responsable válido lo acepta', async () => {
      const fakeTx = {
        delegacionCumplimiento: {
          findMany: async () => [
            { id: 1, responsableId: 99 },
            { id: 2, responsableId: 88 },
          ],
        },
      } as unknown as PrismaTransaction;

      const resId = await resolverResponsableCumplimiento(fakeTx, 10, 2026, 9, 88);
      expect(resId).toBe(88);
    });

    test('Caso 3c: Auditor con múltiples delegaciones activas -> si especifica un responsable no coincidente lanza error', async () => {
      const fakeTx = {
        delegacionCumplimiento: {
          findMany: async () => [
            { id: 1, responsableId: 99 },
            { id: 2, responsableId: 88 },
          ],
        },
      } as unknown as PrismaTransaction;

      await expect(resolverResponsableCumplimiento(fakeTx, 10, 2026, 9, 77))
        .rejects.toThrow('no coincide');
    });
  });

  describe('Días Inhábiles y Fechas de Recordatorio', () => {
    test('Día inhábil oficial (ej. 1 de mayo) retrocede al último día hábil previo', () => {
      // Mayo 2026: 1 de mayo es viernes (Día del Trabajo oficial en México)
      // Si 1 de mayo está marcado como inhábil, el último día hábil previo es el jueves 30 de abril
      const diasInhabiles = new Set(['2026-05-01']);
      const fecha = new Date(2026, 4, 1); // 1 de mayo
      expect(esDiaHabil(fecha, diasInhabiles)).toBe(false);

      const fechaJueves = new Date(2026, 3, 30); // 30 de abril
      expect(esDiaHabil(fechaJueves, diasInhabiles)).toBe(true);
    });

    test('Sábados y Domingos nunca son hábiles', () => {
      const sabado = new Date(2026, 8, 12);
      const domingo = new Date(2026, 8, 13);
      expect(esDiaHabil(sabado)).toBe(false);
      expect(esDiaHabil(domingo)).toBe(false);
    });
  });

  describe('Cálculo Canónico de resultadoMensual y Protección de KPI 50/50 (4 Casos Canónicos)', () => {
    type UpsertInput = {
      promedioAreas: unknown;
      areasConResultado: number;
      kpiFinal: unknown;
      porcentajeCumplimiento: unknown;
    };

    type DetalleInput = {
      areaId: number;
      codigoAreaSnapshot: string;
      nombreAreaSnapshot: string;
      tipoAreaSnapshot: TipoArea;
      resultadoMensualUtilizado: unknown;
    };

    test('Caso 1: P1 100%, P2 pendiente -> resultadoMensual === null y no afecta promedio KPI áreas', async () => {
      // 1. Verificación directa de regla canónica
      const resultadoMensual = calcularResultadoMensualCanonico(100, null, 'A_TIEMPO', 'PENDIENTE');
      expect(resultadoMensual).toBeNull();

      // Si P2 está atrasada pero en periodo de gracia, también debe ser null
      const resultadoAtrasada = calcularResultadoMensualCanonico(100, null, 'A_TIEMPO', 'ATRASADA');
      expect(resultadoAtrasada).toBeNull();

      // 2. Verificación de no afectación de promedio KPI áreas ni materialización en BD
      let upsertPayload: UpsertInput | null = null;
      let detallesCreados: DetalleInput[] = [];

      const mockTx = {
        usuario: {
          findUniqueOrThrow: async () => ({
            id: 1,
            seEvalua: true,
            areasUsuario: [
              {
                area: { id: 101, codigo: 'OP-01', nombre: 'Área 1', tipo: TipoArea.OPERATIVA, activo: true },
              },
            ],
          }),
        },
        cumplimientoMensualUsuario: {
          findUnique: async () => null,
          upsert: async (args: { create: UpsertInput }) => {
            upsertPayload = args.create;
            return { id: 1, ...args.create };
          },
        },
        asignacionAuditoria: {
          findMany: async () => [],
        },
        objetivoAuditoria: {
          findMany: async () => [
            {
              periodo: 1,
              terminaEn: new Date('2026-09-15T23:59:59Z'),
              envioResultado: { id: 1, porcentaje: 100, invalidadoEn: null, realizadaATiempo: true },
              asignacionesAuditoria: [],
            },
            {
              periodo: 2,
              terminaEn: new Date('2026-09-30T23:59:59Z'),
              envioResultado: null,
              asignacionesAuditoria: [],
            },
          ],
        },
        cumplimientoMensualArea: {
          deleteMany: async () => ({ count: 0 }),
          createMany: async (args: { data: DetalleInput[] }) => {
            detallesCreados = args.data;
            return { count: args.data.length };
          },
        },
      } as unknown as PrismaTransaction;

      // Evaluado en fecha actual de septiembre (P2 en curso / pendiente)
      const fechaCorte = new Date('2026-09-16T12:00:00Z');
      const resultado = await calcularYGuardarCumplimientoUsuario(mockTx, 1, 2026, 9, false, fechaCorte);

      expect(resultado.promedioAreas).toBeNull();
      expect(resultado.areasConResultado).toBe(0);
      expect(detallesCreados.length).toBe(0);
      expect(upsertPayload?.promedioAreas).toBeNull();
      expect(upsertPayload?.areasConResultado).toBe(0);
    });

    test('Caso 2: P1 100%, P2 no realizada -> resultadoMensual === 100', async () => {
      // 1. Verificación directa de regla canónica
      const resultadoMensual = calcularResultadoMensualCanonico(100, null, 'A_TIEMPO', 'NO_REALIZADA');
      expect(resultadoMensual).toBe(100);

      // 2. Verificación de cálculo y materialización
      let upsertPayload: UpsertInput | null = null;
      let detallesCreados: DetalleInput[] = [];

      const mockTx = {
        usuario: {
          findUniqueOrThrow: async () => ({
            id: 2,
            seEvalua: true,
            areasUsuario: [
              {
                area: { id: 102, codigo: 'OP-02', nombre: 'Área 2', tipo: TipoArea.OPERATIVA, activo: true },
              },
            ],
          }),
        },
        cumplimientoMensualUsuario: {
          findUnique: async () => null,
          upsert: async (args: { create: UpsertInput }) => {
            upsertPayload = args.create;
            return { id: 2, ...args.create };
          },
        },
        asignacionAuditoria: {
          findMany: async () => [],
        },
        objetivoAuditoria: {
          findMany: async () => [
            {
              periodo: 1,
              terminaEn: new Date('2026-09-15T23:59:59Z'),
              envioResultado: { id: 2, porcentaje: 100, invalidadoEn: null, realizadaATiempo: true },
              asignacionesAuditoria: [],
            },
            {
              periodo: 2,
              terminaEn: new Date('2026-09-30T23:59:59Z'),
              envioResultado: null,
              asignacionesAuditoria: [],
            },
          ],
        },
        cumplimientoMensualArea: {
          deleteMany: async () => ({ count: 0 }),
          createMany: async (args: { data: DetalleInput[] }) => {
            detallesCreados = args.data;
            return { count: args.data.length };
          },
        },
      } as unknown as PrismaTransaction;

      // Evaluado en octubre (después del vencimiento definitivo de P2 con gracia)
      const fechaOctubre = new Date('2026-10-15T12:00:00Z');
      const resultado = await calcularYGuardarCumplimientoUsuario(mockTx, 2, 2026, 9, false, fechaOctubre);

      expect(resultado.promedioAreas).toBe(100);
      expect(resultado.areasConResultado).toBe(1);
      expect(detallesCreados.length).toBe(1);
      expect(Number(detallesCreados[0].resultadoMensualUtilizado)).toBe(100);
      expect(Number(upsertPayload?.promedioAreas)).toBe(100);
    });

    test('Caso 3: P1 no realizada, P2 80% -> resultadoMensual === 80', async () => {
      // 1. Verificación directa de regla canónica
      const resultadoMensual = calcularResultadoMensualCanonico(null, 80, 'NO_REALIZADA', 'A_TIEMPO');
      expect(resultadoMensual).toBe(80);

      // 2. Verificación de cálculo y materialización
      let detallesCreados: DetalleInput[] = [];

      const mockTx = {
        usuario: {
          findUniqueOrThrow: async () => ({
            id: 3,
            seEvalua: true,
            areasUsuario: [
              {
                area: { id: 103, codigo: 'OP-03', nombre: 'Área 3', tipo: TipoArea.OPERATIVA, activo: true },
              },
            ],
          }),
        },
        cumplimientoMensualUsuario: {
          findUnique: async () => null,
          upsert: async (args: { create: UpsertInput }) => ({ id: 3, ...args.create }),
        },
        asignacionAuditoria: {
          findMany: async () => [],
        },
        objetivoAuditoria: {
          findMany: async () => [
            {
              periodo: 1,
              terminaEn: new Date('2026-09-15T23:59:59Z'),
              envioResultado: null,
              asignacionesAuditoria: [],
            },
            {
              periodo: 2,
              terminaEn: new Date('2026-09-30T23:59:59Z'),
              envioResultado: { id: 3, porcentaje: 80, invalidadoEn: null, realizadaATiempo: true },
              asignacionesAuditoria: [],
            },
          ],
        },
        cumplimientoMensualArea: {
          deleteMany: async () => ({ count: 0 }),
          createMany: async (args: { data: DetalleInput[] }) => {
            detallesCreados = args.data;
            return { count: args.data.length };
          },
        },
      } as unknown as PrismaTransaction;

      // En fecha fin de septiembre (P1 ya expiró con gracia hace días)
      const fechaFinSept = new Date('2026-09-28T12:00:00Z');
      const resultado = await calcularYGuardarCumplimientoUsuario(mockTx, 3, 2026, 9, false, fechaFinSept);

      expect(resultado.promedioAreas).toBe(80);
      expect(resultado.areasConResultado).toBe(1);
      expect(detallesCreados.length).toBe(1);
      expect(Number(detallesCreados[0].resultadoMensualUtilizado)).toBe(80);
    });

    test('Caso 4: P1 100%, P2 80% -> resultadoMensual === 90', async () => {
      // 1. Verificación directa de regla canónica
      const resultadoMensual = calcularResultadoMensualCanonico(100, 80, 'A_TIEMPO', 'A_TIEMPO');
      expect(resultadoMensual).toBe(90);

      // 2. Verificación de cálculo y materialización
      let detallesCreados: DetalleInput[] = [];

      const mockTx = {
        usuario: {
          findUniqueOrThrow: async () => ({
            id: 4,
            seEvalua: true,
            areasUsuario: [
              {
                area: { id: 104, codigo: 'OP-04', nombre: 'Área 4', tipo: TipoArea.OPERATIVA, activo: true },
              },
            ],
          }),
        },
        cumplimientoMensualUsuario: {
          findUnique: async () => null,
          upsert: async (args: { create: UpsertInput }) => ({ id: 4, ...args.create }),
        },
        asignacionAuditoria: {
          findMany: async () => [],
        },
        objetivoAuditoria: {
          findMany: async () => [
            {
              periodo: 1,
              terminaEn: new Date('2026-09-15T23:59:59Z'),
              envioResultado: { id: 41, porcentaje: 100, invalidadoEn: null, realizadaATiempo: true },
              asignacionesAuditoria: [],
            },
            {
              periodo: 2,
              terminaEn: new Date('2026-09-30T23:59:59Z'),
              envioResultado: { id: 42, porcentaje: 80, invalidadoEn: null, realizadaATiempo: true },
              asignacionesAuditoria: [],
            },
          ],
        },
        cumplimientoMensualArea: {
          deleteMany: async () => ({ count: 0 }),
          createMany: async (args: { data: DetalleInput[] }) => {
            detallesCreados = args.data;
            return { count: args.data.length };
          },
        },
      } as unknown as PrismaTransaction;

      const resultado = await calcularYGuardarCumplimientoUsuario(mockTx, 4, 2026, 9, false);

      expect(resultado.promedioAreas).toBe(90);
      expect(resultado.areasConResultado).toBe(1);
      expect(detallesCreados.length).toBe(1);
      expect(Number(detallesCreados[0].resultadoMensualUtilizado)).toBe(90);
    });
  });
});
