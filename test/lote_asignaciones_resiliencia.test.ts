import { describe, expect, test } from 'bun:test';
import { Prisma } from '../src/generated/prisma/client';
import { esConflictoTransaccion } from '../src/utils/transaccion';
import { esquemaGuardarLoteAsignaciones } from '../src/modules/asignaciones/zod';

describe('Resiliencia transaccional y detección de deadlocks', () => {
  test('Detecta código P2034 de Prisma como conflicto transaccional', () => {
    const err = new Prisma.PrismaClientKnownRequestError('Transaction conflict', {
      code: 'P2034',
      clientVersion: '7.9.1',
    });
    expect(esConflictoTransaccion(err)).toBe(true);
  });

  test('Detecta error 1213 de MySQL (deadlock) como conflicto transaccional', () => {
    const err = new Error('Raw query failed. Code: `1213`. Message: Deadlock found when trying to get lock; try restarting transaction');
    expect(esConflictoTransaccion(err)).toBe(true);
  });

  test('Ignora errores de reglas de negocio y validación (no los clasifica como deadlock)', () => {
    const errValidacion = new Error('El auditor no puede auditar su propia area');
    const errNoExiste = new Error('El auditor seleccionado no existe o no está activo');
    expect(esConflictoTransaccion(errValidacion)).toBe(false);
    expect(esConflictoTransaccion(errNoExiste)).toBe(false);
  });
});

describe('Validación de esquema de lote en Zod', () => {
  test('Acepta lote válido de asignaciones con orden arbitrario', () => {
    const payload = {
      anio: 2026,
      mes: 10,
      asignaciones: [
        { areaId: 28, auditorMensualId: 5, expectedAuditorId: null },
        { areaId: 12, auditorMensualId: 8, expectedAuditorId: 3 },
      ],
    };
    const parsed = esquemaGuardarLoteAsignaciones.safeParse(payload);
    expect(parsed.success).toBe(true);
  });

  test('Rechaza lote si un areaId viene duplicado en el mismo payload', () => {
    const payloadDuplicado = {
      anio: 2026,
      mes: 10,
      asignaciones: [
        { areaId: 28, auditorMensualId: 5 },
        { areaId: 28, auditorMensualId: 8 },
      ],
    };
    const parsed = esquemaGuardarLoteAsignaciones.safeParse(payloadDuplicado);
    expect(parsed.success).toBe(false);
  });

  test('Rechaza lote vacío sin asignaciones', () => {
    const payloadVacio = {
      anio: 2026,
      mes: 10,
      asignaciones: [],
    };
    const parsed = esquemaGuardarLoteAsignaciones.safeParse(payloadVacio);
    expect(parsed.success).toBe(false);
  });
});
