import { describe, expect, test } from 'bun:test';
import { areaEsAuditableEnPeriodo, fechaFinDeMes, fechaInicioDeMes } from '../modules/areas/servicio_vigencia_area';
import { construirPeriodoResumen, construirResultadoMensualCanonico, construirGanadoresPorTipo } from '../modules/resultados/servicio';
import { TipoArea } from '../generated/prisma/enums';

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

    test('P1 NO_REALIZADA, P2 realizado (100%) -> Resultado mensual = 100% (respeta el periodo realizado)', () => {
      const periodos = [
        { periodo: 1, completado: false, estado: 'NO_REALIZADA', porcentaje: null } as unknown as Parameters<typeof construirResultadoMensualCanonico>[0][number],
        { periodo: 2, completado: true, estado: 'REALIZADA', porcentaje: 100 } as unknown as Parameters<typeof construirResultadoMensualCanonico>[0][number],
      ];
      expect(construirResultadoMensualCanonico(periodos)).toBe(100);
    });

    test('P1 realizado (100%), P2 NO_REALIZADA -> Resultado mensual = 100% (respeta el periodo realizado)', () => {
      const periodos = [
        { periodo: 1, completado: true, estado: 'REALIZADA', porcentaje: 100 } as unknown as Parameters<typeof construirResultadoMensualCanonico>[0][number],
        { periodo: 2, completado: false, estado: 'NO_REALIZADA', porcentaje: null } as unknown as Parameters<typeof construirResultadoMensualCanonico>[0][number],
      ];
      expect(construirResultadoMensualCanonico(periodos)).toBe(100);
    });

    test('Ambos periodos NO_REALIZADA -> Resultado mensual = null (sin auditorías realizadas)', () => {
      const periodos = [
        { periodo: 1, completado: false, estado: 'NO_REALIZADA', porcentaje: null } as unknown as Parameters<typeof construirResultadoMensualCanonico>[0][number],
        { periodo: 2, completado: false, estado: 'NO_REALIZADA', porcentaje: null } as unknown as Parameters<typeof construirResultadoMensualCanonico>[0][number],
      ];
      expect(construirResultadoMensualCanonico(periodos)).toBe(null);
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

  describe('Elegibilidad de Ganadores por Nivel 1 y Nivel 2 Fallback', () => {
    test('1. Operativo: completo 100/100 vs incompleto NO_REALIZADA/100 -> gana solamente el completo', () => {
      const areaCompleta = {
        area: { id: 1, codigo: 'MANT', nombre: 'MANTENIMIENTO', tipo: TipoArea.OPERATIVA, esPropia: false },
        resultadoMensual: 100,
        periodos: [
          { periodo: 1, completado: true, estado: 'REALIZADA', porcentaje: 100 },
          { periodo: 2, completado: true, estado: 'REALIZADA', porcentaje: 100 },
        ],
        estadoMes: 'REALIZADA',
      } as unknown as Parameters<typeof construirGanadoresPorTipo>[0][number];

      const areaIncompleta = {
        area: { id: 2, codigo: 'BILL', nombre: 'BILLETERAS', tipo: TipoArea.OPERATIVA, esPropia: false },
        resultadoMensual: 100,
        periodos: [
          { periodo: 1, completado: false, estado: 'NO_REALIZADA', porcentaje: null },
          { periodo: 2, completado: true, estado: 'REALIZADA', porcentaje: 100 },
        ],
        estadoMes: 'INCOMPLETA',
      } as unknown as Parameters<typeof construirGanadoresPorTipo>[0][number];

      const ganadores = construirGanadoresPorTipo([areaCompleta, areaIncompleta]);
      expect(ganadores.operativo.resultado).toBe(100);
      expect(ganadores.operativo.areas).toHaveLength(1);
      expect(ganadores.operativo.areas[0].nombre).toBe('MANTENIMIENTO');
    });

    test('2. Administrativo: ningún completo; dos NO_REALIZADA/100 y uno NO_REALIZADA/82.60 -> ganan los dos de 100', () => {
      const admin1 = {
        area: { id: 10, codigo: 'IMG', nombre: 'IMAGEN - DISEÑO', tipo: TipoArea.ADMINISTRATIVA, esPropia: false },
        resultadoMensual: 100,
        periodos: [
          { periodo: 1, completado: false, estado: 'NO_REALIZADA', porcentaje: null },
          { periodo: 2, completado: true, estado: 'REALIZADA', porcentaje: 100 },
        ],
        estadoMes: 'INCOMPLETA',
      } as unknown as Parameters<typeof construirGanadoresPorTipo>[0][number];

      const admin2 = {
        area: { id: 11, codigo: 'SIG', nombre: 'OFICINA DE SIGMA - VIGILANCIA', tipo: TipoArea.ADMINISTRATIVA, esPropia: false },
        resultadoMensual: 100,
        periodos: [
          { periodo: 1, completado: false, estado: 'NO_REALIZADA', porcentaje: null },
          { periodo: 2, completado: true, estado: 'REALIZADA', porcentaje: 100 },
        ],
        estadoMes: 'INCOMPLETA',
      } as unknown as Parameters<typeof construirGanadoresPorTipo>[0][number];

      const admin3 = {
        area: { id: 12, codigo: 'ADM', nombre: 'ADMINISTRACION', tipo: TipoArea.ADMINISTRATIVA, esPropia: false },
        resultadoMensual: 82.60,
        periodos: [
          { periodo: 1, completado: false, estado: 'NO_REALIZADA', porcentaje: null },
          { periodo: 2, completado: true, estado: 'REALIZADA', porcentaje: 82.60 },
        ],
        estadoMes: 'INCOMPLETA',
      } as unknown as Parameters<typeof construirGanadoresPorTipo>[0][number];

      const ganadores = construirGanadoresPorTipo([admin1, admin2, admin3]);
      expect(ganadores.administrativo.resultado).toBe(100);
      expect(ganadores.administrativo.areas).toHaveLength(2);
      expect(ganadores.administrativo.areas.map((a) => a.nombre)).toEqual([
        'IMAGEN - DISEÑO',
        'OFICINA DE SIGMA - VIGILANCIA',
      ]);
    });

    test('3. Ningún completo y resultados 97/91 -> gana 97', () => {
      const area97 = {
        area: { id: 20, codigo: 'A97', nombre: 'Área 97', tipo: TipoArea.OPERATIVA, esPropia: false },
        resultadoMensual: 97,
        periodos: [
          { periodo: 1, completado: false, estado: 'NO_REALIZADA', porcentaje: null },
          { periodo: 2, completado: true, estado: 'REALIZADA', porcentaje: 97 },
        ],
        estadoMes: 'INCOMPLETA',
      } as unknown as Parameters<typeof construirGanadoresPorTipo>[0][number];

      const area91 = {
        area: { id: 21, codigo: 'A91', nombre: 'Área 91', tipo: TipoArea.OPERATIVA, esPropia: false },
        resultadoMensual: 91,
        periodos: [
          { periodo: 1, completado: false, estado: 'NO_REALIZADA', porcentaje: null },
          { periodo: 2, completado: true, estado: 'REALIZADA', porcentaje: 91 },
        ],
        estadoMes: 'INCOMPLETA',
      } as unknown as Parameters<typeof construirGanadoresPorTipo>[0][number];

      const ganadores = construirGanadoresPorTipo([area97, area91]);
      expect(ganadores.operativo.resultado).toBe(97);
      expect(ganadores.operativo.areas).toHaveLength(1);
      expect(ganadores.operativo.areas[0].nombre).toBe('Área 97');
    });

    test('4. Ninguna área con ningún periodo realizado -> sin ganadores', () => {
      const areaSinEnvio = {
        area: { id: 30, codigo: 'VACIA', nombre: 'Área Vacía', tipo: TipoArea.OPERATIVA, esPropia: false },
        resultadoMensual: null,
        periodos: [
          { periodo: 1, completado: false, estado: 'NO_REALIZADA', porcentaje: null },
          { periodo: 2, completado: false, estado: 'NO_REALIZADA', porcentaje: null },
        ],
        estadoMes: 'NO_REALIZADA',
      } as unknown as Parameters<typeof construirGanadoresPorTipo>[0][number];

      const ganadores = construirGanadoresPorTipo([areaSinEnvio]);
      expect(ganadores.operativo.resultado).toBe(null);
      expect(ganadores.operativo.areas).toHaveLength(0);
    });

    test('5. Confirmar que NO_REALIZADA + 100 continúa produciendo resultado mensual 100', () => {
      const periodos1 = [
        { periodo: 1, completado: false, estado: 'NO_REALIZADA', porcentaje: null },
        { periodo: 2, completado: true, estado: 'REALIZADA', porcentaje: 100 },
      ] as unknown as Parameters<typeof construirResultadoMensualCanonico>[0];
      expect(construirResultadoMensualCanonico(periodos1)).toBe(100);

      const periodos2 = [
        { periodo: 1, completado: true, estado: 'REALIZADA', porcentaje: 100 },
        { periodo: 2, completado: false, estado: 'NO_REALIZADA', porcentaje: null },
      ] as unknown as Parameters<typeof construirResultadoMensualCanonico>[0];
      expect(construirResultadoMensualCanonico(periodos2)).toBe(100);
    });
  });

  describe('Auditor Ejecutor (Apoyo / Invitado / Titular)', () => {
    test('Auditor titular devuelve etiqueta null', () => {
      const objetivo = {
        id: 1,
        canceladoEn: null,
        anio: 2026,
        mes: 8,
        periodo: 1,
        iniciaEn: new Date(2026, 7, 1),
        terminaEn: new Date(2026, 7, 15),
        envioResultado: {
          id: 50,
          porcentaje: 95,
          puntajeObtenido: 95,
          puntajePosible: 100,
          finalizadoEn: new Date(),
          recibidoEn: new Date(),
          invalidadoEn: null,
          nombreAuditorSnapshot: 'Juan Pérez',
          origen: 'USUARIO',
          enviadoPorUsuarioId: 10,
          enlaceInvitadoId: null,
          asignacionAuditoria: { auditorId: 10, auditor: { nombre: 'Juan Pérez' } },
          respuestasAuditoria: [],
        },
      } as unknown as Parameters<typeof construirPeriodoResumen>[0];

      const resumen = construirPeriodoResumen(objetivo, 1);
      expect(resumen.auditorEjecutor).toBeDefined();
      expect(resumen.auditorEjecutor?.nombre).toBe('Juan Pérez');
      expect(resumen.auditorEjecutor?.esApoyo).toBe(false);
      expect(resumen.auditorEjecutor?.esInvitado).toBe(false);
      expect(resumen.auditorEjecutor?.etiqueta).toBe(null);
    });

    test('Auditor comodín/apoyo devuelve etiqueta Apoyo: [Nombre]', () => {
      const objetivo = {
        id: 2,
        canceladoEn: null,
        anio: 2026,
        mes: 8,
        periodo: 1,
        iniciaEn: new Date(2026, 7, 1),
        terminaEn: new Date(2026, 7, 15),
        envioResultado: {
          id: 51,
          porcentaje: 90,
          puntajeObtenido: 90,
          puntajePosible: 100,
          finalizadoEn: new Date(),
          recibidoEn: new Date(),
          invalidadoEn: null,
          nombreAuditorSnapshot: 'Admin Comodín',
          origen: 'USUARIO',
          enviadoPorUsuarioId: 99,
          enlaceInvitadoId: null,
          asignacionAuditoria: { auditorId: 10, auditor: { nombre: 'Juan Pérez' } },
          respuestasAuditoria: [],
        },
      } as unknown as Parameters<typeof construirPeriodoResumen>[0];

      const resumen = construirPeriodoResumen(objetivo, 1);
      expect(resumen.auditorEjecutor?.esApoyo).toBe(true);
      expect(resumen.auditorEjecutor?.esInvitado).toBe(false);
      expect(resumen.auditorEjecutor?.etiqueta).toBe('Apoyo: Admin Comodín');
    });

    test('Auditor invitado devuelve etiqueta Invitado: [Nombre]', () => {
      const objetivo = {
        id: 3,
        canceladoEn: null,
        anio: 2026,
        mes: 8,
        periodo: 1,
        iniciaEn: new Date(2026, 7, 1),
        terminaEn: new Date(2026, 7, 15),
        envioResultado: {
          id: 52,
          porcentaje: 88,
          puntajeObtenido: 88,
          puntajePosible: 100,
          finalizadoEn: new Date(),
          recibidoEn: new Date(),
          invalidadoEn: null,
          nombreAuditorSnapshot: 'Visitante Externo',
          origen: 'INVITADO',
          enviadoPorUsuarioId: null,
          enlaceInvitadoId: 4,
          asignacionAuditoria: { auditorId: 10, auditor: { nombre: 'Juan Pérez' } },
          respuestasAuditoria: [],
        },
      } as unknown as Parameters<typeof construirPeriodoResumen>[0];

      const resumen = construirPeriodoResumen(objetivo, 1);
      expect(resumen.auditorEjecutor?.esApoyo).toBe(false);
      expect(resumen.auditorEjecutor?.esInvitado).toBe(true);
      expect(resumen.auditorEjecutor?.etiqueta).toBe('Invitado: Visitante Externo');
    });
  });
});
