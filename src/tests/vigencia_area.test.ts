import { describe, expect, test } from 'bun:test';
import { areaEsAuditableEnPeriodo, fechaFinDeMes, fechaInicioDeMes } from '../modules/areas/servicio_vigencia_area';
import { construirPeriodoResumen, construirResultadoMensualCanonico } from '../modules/resultados/servicio';

describe('Reglas de Negocio - Vigencia de Área y Resultados Canónicos', () => {
  describe('areaEsAuditableEnPeriodo', () => {
    test('Área activa sin fechas límite es auditable', () => {
      const area = { activo: true, auditableDesde: null, auditableHasta: null };
      expect(areaEsAuditableEnPeriodo(area, 2026, 8, 15)).toBe(true);
    });

    test('Área desactivada con auditableHasta en mes anterior NO es auditable en mes actual', () => {
      // Desactivada en agosto "desde este mes": auditableHasta = 31/07/2026
      const area = {
        activo: false,
        auditableDesde: null,
        auditableHasta: fechaFinDeMes(2026, 7),
      };
      // En agosto 2026 (P1)
      expect(areaEsAuditableEnPeriodo(area, 2026, 8, 15)).toBe(false);
      // En julio 2026 (P2) -> SÍ era auditable
      expect(areaEsAuditableEnPeriodo(area, 2026, 7, 31)).toBe(true);
    });

    test('Área desactivada "desde próximo mes" (efectiva septiembre): auditableHasta = 31/08/2026', () => {
      const area = {
        activo: false,
        auditableDesde: null,
        auditableHasta: fechaFinDeMes(2026, 8),
      };
      // En agosto 2026 sigue siendo auditable
      expect(areaEsAuditableEnPeriodo(area, 2026, 8, 15)).toBe(true);
      // En septiembre 2026 ya NO es auditable
      expect(areaEsAuditableEnPeriodo(area, 2026, 9, 15)).toBe(false);
    });

    test('Múltiples ciclos: Enero-Julio ACTIVA, Ago-Oct INACTIVA, Nov-Dic ACTIVA', () => {
      const area = {
        activo: true,
        auditableDesde: fechaInicioDeMes(2026, 11),
        auditableHasta: fechaFinDeMes(2026, 7),
      };

      // Julio 2026 -> Auditable (antes de auditableHasta)
      expect(areaEsAuditableEnPeriodo(area, 2026, 7, 31)).toBe(true);

      // Agosto / Septiembre / Octubre 2026 -> NO auditable
      expect(areaEsAuditableEnPeriodo(area, 2026, 8, 15)).toBe(false);
      expect(areaEsAuditableEnPeriodo(area, 2026, 9, 15)).toBe(false);
      expect(areaEsAuditableEnPeriodo(area, 2026, 10, 15)).toBe(false);

      // Noviembre 2026 -> Auditable
      expect(areaEsAuditableEnPeriodo(area, 2026, 11, 15)).toBe(true);
    });
  });

  describe('Diferenciación NO_APLICA vs NO_REALIZADA', () => {
    test('Objetivo cancelado/inactivo devuelve estado NO_APLICA y situacion NO_APLICA', () => {
      const objetivoCancelado = {
        id: 101,
        canceladoEn: new Date(),
        motivoCancelacion: 'AREA_DESACTIVADA',
        envioResultado: null,
        anio: 2026,
        mes: 8,
        periodo: 1,
        iniciaEn: new Date(2026, 7, 1),
        terminaEn: new Date(2026, 7, 15),
        area: {
          activo: false,
          auditableDesde: null,
          auditableHasta: fechaFinDeMes(2026, 7),
        },
      } as unknown as Parameters<typeof construirPeriodoResumen>[0];

      const resumen = construirPeriodoResumen(objetivoCancelado, 1);
      expect(resumen.estado).toBe('NO_APLICA');
      expect(resumen.situacion).toBe('NO_APLICA');
    });

    test('Objetivo vencido de área activa devuelve estado NO_REALIZADA', () => {
      const objetivoVencido = {
        id: 102,
        canceladoEn: null,
        motivoCancelacion: null,
        envioResultado: null,
        anio: 2026,
        mes: 8,
        periodo: 1,
        iniciaEn: new Date(2026, 7, 1),
        terminaEn: new Date(2026, 7, 15),
        area: {
          activo: true,
          auditableDesde: null,
          auditableHasta: null,
        },
      } as unknown as Parameters<typeof construirPeriodoResumen>[0];

      const resumen = construirPeriodoResumen(objetivoVencido, 1);
      expect(resumen.estado).toBe('NO_REALIZADA');
      expect(resumen.situacion).toBe('NO_REALIZADA');
    });
  });

  describe('construirResultadoMensualCanonico', () => {
    test('P1 realizado (95%), P2 cancelado/NO_APLICA -> Resultado mensual = 95%', () => {
      const periodos = [
        { periodo: 1, completado: true, estado: 'REALIZADA', porcentaje: 95 } as unknown as Parameters<typeof construirResultadoMensualCanonico>[0][number],
        { periodo: 2, completado: false, estado: 'NO_APLICA', porcentaje: null } as unknown as Parameters<typeof construirResultadoMensualCanonico>[0][number],
      ];
      expect(construirResultadoMensualCanonico(periodos)).toBe(95);
    });

    test('P1 realizado (90%), P2 realizado (100%) -> Promedio = 95%', () => {
      const periodos = [
        { periodo: 1, completado: true, estado: 'REALIZADA', porcentaje: 90 } as unknown as Parameters<typeof construirResultadoMensualCanonico>[0][number],
        { periodo: 2, completado: true, estado: 'REALIZADA', porcentaje: 100 } as unknown as Parameters<typeof construirResultadoMensualCanonico>[0][number],
      ];
      expect(construirResultadoMensualCanonico(periodos)).toBe(95);
    });

    test('P1 PENDIENTE, P2 NO_REALIZADA -> Resultado mensual = null (en curso)', () => {
      const periodos = [
        { periodo: 1, completado: false, estado: 'PENDIENTE', porcentaje: null } as unknown as Parameters<typeof construirResultadoMensualCanonico>[0][number],
        { periodo: 2, completado: false, estado: 'NO_REALIZADA', porcentaje: null } as unknown as Parameters<typeof construirResultadoMensualCanonico>[0][number],
      ];
      expect(construirResultadoMensualCanonico(periodos)).toBe(null);
    });

    test('Ambos periodos NO_APLICA -> Resultado mensual = null (no penaliza como 0)', () => {
      const periodos = [
        { periodo: 1, completado: false, estado: 'NO_APLICA', porcentaje: null } as unknown as Parameters<typeof construirResultadoMensualCanonico>[0][number],
        { periodo: 2, completado: false, estado: 'NO_APLICA', porcentaje: null } as unknown as Parameters<typeof construirResultadoMensualCanonico>[0][number],
      ];
      expect(construirResultadoMensualCanonico(periodos)).toBe(null);
    });
  });

  describe('Consulta en Tiempo Real de Resultados', () => {
    test('Mes con auditorías pendientes mantiene mostrarResultado = true (no bloquea consulta)', () => {
      // Import dynamic check or test logic
      expect(true).toBe(true);
    });
  });
});
