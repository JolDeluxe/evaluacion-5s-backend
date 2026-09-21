import { describe, expect, test } from 'bun:test';
import { prisma } from '../src/db';
import { transaccionSerializable } from '../src/utils/transaccion';

describe('Pruebas funcionales de procesamiento en lote e integración', () => {
  test('Procesamiento secuencial con guardado parcial ante fallo en una de las áreas', async () => {
    // Tomar 2 áreas reales activas de la BD para la prueba
    const areas = await prisma.area.findMany({
      where: { activo: true },
      take: 2,
      orderBy: { id: 'asc' },
    });

    if (areas.length < 2) {
      console.warn('Se requieren al menos 2 áreas para esta prueba');
      return;
    }

    const areaValida = areas[0];
    const areaInvalida = areas[1];

    // Buscar auditor activo válido
    const auditor = await prisma.usuario.findFirst({
      where: { activo: true, rol: { in: ['AUDITOR', 'ADMINISTRADOR'] }, puedeSerAsignadoAuditoria: true },
    });

    if (!auditor) {
      console.warn('No hay auditor disponible para la prueba');
      return;
    }

    const loteSimulado = [
      { areaId: areaValida.id, auditorMensualId: auditor.id, expectedAuditorId: null },
      { areaId: areaInvalida.id, auditorMensualId: 999999, expectedAuditorId: null }, // ID inexistente para forzar fallo de negocio
    ];

    const guardadas: number[] = [];
    const fallidas: Array<{ areaId: number; motivo: string }> = [];

    // Simular el loop de 16_guardar_lote.ts
    const asignacionesOrdenadas = [...loteSimulado].sort((a, b) => a.areaId - b.areaId);

    for (const item of asignacionesOrdenadas) {
      try {
        await transaccionSerializable(async (tx) => {
          // Validar auditor
          const usuario = await tx.usuario.findUnique({ where: { id: item.auditorMensualId } });
          if (!usuario || !usuario.activo) {
            throw new Error('El auditor seleccionado no existe o no está activo');
          }
        });
        guardadas.push(item.areaId);
      } catch (err: unknown) {
        const motivo = err instanceof Error ? err.message : 'Error';
        fallidas.push({ areaId: item.areaId, motivo });
      }
    }

    // Comprobación de aislamiento: el área válida pasa y el área inválida falla sin afectar a la primera
    expect(guardadas).toContain(areaValida.id);
    expect(fallidas.some((f) => f.areaId === areaInvalida.id)).toBe(true);
    expect(fallidas.find((f) => f.areaId === areaInvalida.id)?.motivo).toContain('El auditor seleccionado no existe o no está activo');
  });

  test('Reintento automático exitoso ante Deadlock 1213 simulado con transaccionSerializable', async () => {
    let intentos = 0;
    const resultado = await transaccionSerializable(async () => {
      intentos++;
      if (intentos < 3) {
        // Simular error 1213 de MySQL en los dos primeros intentos
        throw new Error('Raw query failed. Code: `1213`. Message: Deadlock found when trying to get lock; try restarting transaction');
      }
      return 'EXITO_TRAS_DEADLOCK';
    });

    expect(resultado).toBe('EXITO_TRAS_DEADLOCK');
    expect(intentos).toBe(3);
  });
});
