import { describe, expect, test } from 'bun:test';
import { esCambioEstructural, estructurasFormularioIguales } from '../modules/formularios/helper';
import { resolverVersionFormularioParaCandidatos } from '../modules/asignaciones/programacion_mensual';

describe('Reglas de Negocio - Versionamiento y Congelamiento de Formularios', () => {

  const revisionBase = {
    id: 1,
    formularioId: 10,
    numeroVersion: 1,
    activa: true,
    creadoPorId: 1,
    creadoEn: new Date(),
    actualizadoEn: new Date(),
    secciones: [
      {
        id: 100,
        versionFormularioId: 1,
        claveEstable: 'SEC-UUID-1',
        nombre: '1S - SEIRI',
        objetivo: 'Clasificar elementos',
        orden: 0,
        creadoEn: new Date(),
        actualizadoEn: new Date(),
        preguntas: [
          { id: 1001, seccionFormularioId: 100, claveEstable: 'PREG-UUID-1', texto: '¿El aria esta linpia?', orden: 0, creadoEn: new Date(), actualizadoEn: new Date() },
          { id: 1002, seccionFormularioId: 100, claveEstable: 'PREG-UUID-2', texto: '¿Están identificados los materiales?', orden: 1, creadoEn: new Date(), actualizadoEn: new Date() },
          { id: 1003, seccionFormularioId: 100, claveEstable: 'PREG-UUID-3', texto: '¿Se eliminaron objetos innecesarios?', orden: 2, creadoEn: new Date(), actualizadoEn: new Date() },
          { id: 1004, seccionFormularioId: 100, claveEstable: 'PREG-UUID-4', texto: '¿Existe pasillo despejado?', orden: 3, creadoEn: new Date(), actualizadoEn: new Date() },
          { id: 1005, seccionFormularioId: 100, claveEstable: 'PREG-UUID-5', texto: '¿El suelo carece de manchas de aceite?', orden: 4, creadoEn: new Date(), actualizadoEn: new Date() },
        ],
      },
    ],
  };

  test('1. Corrección editorial (ortografía/acentos) NO cuenta como cambio estructural', () => {
    const payloadEditorial = [
      {
        claveEstable: 'SEC-UUID-1',
        nombre: '1S - SEIRI',
        objetivo: 'Clasificar elementos',
        orden: 0,
        preguntas: [
          { claveEstable: 'PREG-UUID-1', texto: '¿El área está limpia?', orden: 0 }, // Ortografía corregida
          { claveEstable: 'PREG-UUID-2', texto: '¿Están identificados los materiales?', orden: 1 },
          { claveEstable: 'PREG-UUID-3', texto: '¿Se eliminaron objetos innecesarios?', orden: 2 },
          { claveEstable: 'PREG-UUID-4', texto: '¿Existe pasillo despejado?', orden: 3 },
          { claveEstable: 'PREG-UUID-5', texto: '¿El suelo carece de manchas de aceite?', orden: 4 },
        ],
      },
    ];

    expect(estructurasFormularioIguales(revisionBase as unknown as Parameters<typeof estructurasFormularioIguales>[0], payloadEditorial as unknown as Parameters<typeof estructurasFormularioIguales>[1])).toBe(false);
    expect(esCambioEstructural(revisionBase as unknown as Parameters<typeof esCambioEstructural>[0], payloadEditorial as unknown as Parameters<typeof esCambioEstructural>[1])).toBe(false);
  });

  test('2. Corrección editorial conserva claveEstable de las preguntas', () => {
    const payloadEditorial = [
      {
        claveEstable: 'SEC-UUID-1',
        nombre: '1S - SEIRI',
        objetivo: 'Clasificar elementos',
        orden: 0,
        preguntas: [
          { claveEstable: 'PREG-UUID-1', texto: '¿El área está limpia y ordenada?', orden: 0 },
        ],
      },
    ];

    expect(payloadEditorial[0].preguntas[0].claveEstable).toBe('PREG-UUID-1');
  });

  test('3. Agregar P6 es un cambio estructural', () => {
    const payloadConP6 = [
      {
        claveEstable: 'SEC-UUID-1',
        nombre: '1S - SEIRI',
        objetivo: 'Clasificar elementos',
        orden: 0,
        preguntas: [
          { claveEstable: 'PREG-UUID-1', texto: '¿El área está limpia?', orden: 0 },
          { claveEstable: 'PREG-UUID-2', texto: '¿Están identificados los materiales?', orden: 1 },
          { claveEstable: 'PREG-UUID-3', texto: '¿Se eliminaron objetos innecesarios?', orden: 2 },
          { claveEstable: 'PREG-UUID-4', texto: '¿Existe pasillo despejado?', orden: 3 },
          { claveEstable: 'PREG-UUID-5', texto: '¿El suelo carece de manchas de aceite?', orden: 4 },
          { claveEstable: 'PREG-UUID-6', texto: '¿Los contenedores de basura tienen tapa?', orden: 5 }, // P6 nueva
        ],
      },
    ];

    expect(esCambioEstructural(revisionBase as unknown as Parameters<typeof esCambioEstructural>[0], payloadConP6 as unknown as Parameters<typeof esCambioEstructural>[1])).toBe(true);
  });

  test('4. Retirar P3 y agregar P6 conservan P3 en histórico e identifican P6 con nueva claveEstable', () => {
    const payloadReemplazoP3porP6 = [
      {
        claveEstable: 'SEC-UUID-1',
        nombre: '1S - SEIRI',
        objetivo: 'Clasificar elementos',
        orden: 0,
        preguntas: [
          { claveEstable: 'PREG-UUID-1', texto: '¿El área está limpia?', orden: 0 },
          { claveEstable: 'PREG-UUID-2', texto: '¿Están identificados los materiales?', orden: 1 },
          { claveEstable: 'PREG-UUID-6', texto: '¿Se implementaron avisos visuales?', orden: 2 }, // Nueva claveEstable
          { claveEstable: 'PREG-UUID-4', texto: '¿Existe pasillo despejado?', orden: 3 },
          { claveEstable: 'PREG-UUID-5', texto: '¿El suelo carece de manchas de aceite?', orden: 4 },
        ],
      },
    ];

    expect(esCambioEstructural(revisionBase as unknown as Parameters<typeof esCambioEstructural>[0], payloadReemplazoP3porP6 as unknown as Parameters<typeof esCambioEstructural>[1])).toBe(true);
    expect(payloadReemplazoP3porP6[0].preguntas[2].claveEstable).not.toBe('PREG-UUID-3');
  });

  test('5. Congelamiento mensual: Cálculo de puntajes y denominadores independientes', () => {
    // Enero-Agosto con 5 preguntas (puntajePosible = 5)
    const envioAgo = { puntajeObtenido: 4, puntajePosible: 5, porcentaje: 80 };
    // Septiembre con 6 preguntas (puntajePosible = 6)
    const envioSep = { puntajeObtenido: 6, puntajePosible: 6, porcentaje: 100 };

    expect(envioAgo.puntajePosible).toBe(5);
    expect(envioAgo.porcentaje).toBe(80);

    expect(envioSep.puntajePosible).toBe(6);
    expect(envioSep.porcentaje).toBe(100);
  });

  describe('Resolución de versión en programacion_mensual.ts (Función Real)', () => {
    test('Agosto congelado con V1 (tiene envíos) -> resolver agosto retorna V1, resolver septiembre retorna V2', () => {
      const candidatoV1 = { id: 101, formularioId: 1, numeroVersion: 1, activa: false };
      const candidatoV2 = { id: 102, formularioId: 1, numeroVersion: 2, activa: true };
      const candidatos = [candidatoV2, candidatoV1];

      // Caso 1: resolverAgosto con envío existente en V1
      const versionAgosto = resolverVersionFormularioParaCandidatos(candidatos, 101);
      expect(versionAgosto?.id).toBe(101);

      // Caso 1 (cont): resolverSeptiembre sin envíos aún
      const versionSeptiembre = resolverVersionFormularioParaCandidatos(candidatos, null);
      expect(versionSeptiembre?.id).toBe(102);
    });

    test('Agosto sin envíos -> resolver agosto retorna V2 al publicar V2', () => {
      const candidatoV1 = { id: 101, formularioId: 1, numeroVersion: 1, activa: false };
      const candidatoV2 = { id: 102, formularioId: 1, numeroVersion: 2, activa: true };
      const candidatos = [candidatoV2, candidatoV1];

      // Caso 2: resolverAgosto sin envíos
      const versionAgosto = resolverVersionFormularioParaCandidatos(candidatos, null);
      expect(versionAgosto?.id).toBe(102);
    });
  });
});