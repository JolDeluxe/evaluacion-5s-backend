import { describe, expect, test } from 'bun:test';
import { calcularKpiFinal, determinarEstadoChip } from '../modules/cumplimientos/servicio_kpi';
import { resolverResponsableCumplimiento } from '../modules/asignaciones/programacion_mensual';
import { esDiaHabil } from '../utils/periodos';
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
});
