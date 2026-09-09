/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it, afterAll } from 'bun:test';
import { CanalNotificacion, EstadoEntregaNotificacion, TipoNotificacion } from '../generated/prisma/enums';
import { prisma } from '../db';
import { listarEntregasNotificacionSistema } from '../modules/sistema/04_entregas_notificacion';

describe('Cargar Más (Cursor Pagination) y Filtros en Entregas del Sistema', () => {
  // Generador de dataset en memoria
  const crearDataset = (total: number, cantidadFallidas: number = 0) => {
    const fechaBase = new Date('2026-09-08T10:00:00.000Z').getTime();
    return Array.from({ length: total }, (_, i) => {
      const id = i + 1;
      const estado = i < total - cantidadFallidas
        ? EstadoEntregaNotificacion.ENVIADA
        : EstadoEntregaNotificacion.FALLIDA;
      const creadoEn = new Date(fechaBase + i * 60000);
      return {
        id,
        canal: CanalNotificacion.CORREO,
        estado,
        destinoSnapshot: `usuario${id}@empresa.com`,
        programadoEn: creadoEn,
        proximoIntentoEn: null,
        bloqueadoHasta: null,
        bloqueadoPor: null,
        intentos: estado === EstadoEntregaNotificacion.FALLIDA ? 3 : 1,
        enviadoEn: estado === EstadoEntregaNotificacion.ENVIADA ? creadoEn : null,
        ultimoIntentoEn: creadoEn,
        idMensajeExterno: estado === EstadoEntregaNotificacion.ENVIADA ? `<msg-${id}@mail.com>` : null,
        ultimoError: estado === EstadoEntregaNotificacion.FALLIDA ? 'SMTP Timeout 550' : null,
        creadoEn,
        actualizadoEn: creadoEn,
        notificacion: {
          id: 1000 + id,
          tipo: TipoNotificacion.ASIGNACION_MENSUAL_CORREO,
          titulo: `Auditorías asignadas #${id}`,
          usuarioId: 10 + (id % 5),
          creadoEn,
        },
      };
    });
  };

  let datasetActual = crearDataset(112, 12);

  // Guardar implementaciones originales de prisma
  const originalCount = prisma.entregaNotificacion.count;
  const originalFindMany = prisma.entregaNotificacion.findMany;

  let ultimasLlamadasFindMany: any[] = [];
  prisma.entregaNotificacion.count = (async (args: any) => {
    let filtrados = [...datasetActual];
    if (args?.where?.canal) {
      filtrados = filtrados.filter((item) => item.canal === args.where.canal);
    }
    if (args?.where?.estado) {
      filtrados = filtrados.filter((item) => item.estado === args.where.estado);
    }
    return filtrados.length;
  }) as any;

  prisma.entregaNotificacion.findMany = (async (args: any) => {
    ultimasLlamadasFindMany.push(args);
    let filtrados = [...datasetActual];
    if (args?.where?.canal) {
      filtrados = filtrados.filter((item) => item.canal === args.where.canal);
    }
    if (args?.where?.estado) {
      filtrados = filtrados.filter((item) => item.estado === args.where.estado);
    }

    // Orden determinista: creadoEn desc, luego id desc
    if (args?.orderBy && Array.isArray(args.orderBy)) {
      filtrados.sort((a, b) => {
        for (const orden of args.orderBy) {
          if (orden.creadoEn) {
            const diff = b.creadoEn.getTime() - a.creadoEn.getTime();
            if (diff !== 0) return orden.creadoEn === 'desc' ? diff : -diff;
          }
          if (orden.id) {
            const diff = b.id - a.id;
            if (diff !== 0) return orden.id === 'desc' ? diff : -diff;
          }
        }
        return 0;
      });
    }

    // Manejo de cursor
    let startIndex = 0;
    if (args?.cursor?.id) {
      const idx = filtrados.findIndex((item) => item.id === args.cursor.id);
      if (idx >= 0) {
        startIndex = idx + (args?.skip || 0);
      }
    } else if (args?.skip) {
      startIndex = args.skip;
    }

    const take = args?.take !== undefined ? args.take : 25;
    return filtrados.slice(startIndex, startIndex + take);
  }) as any;

  afterAll(() => {
    prisma.entregaNotificacion.count = originalCount;
    prisma.entregaNotificacion.findMany = originalFindMany;
  });

  const ejecutarListar = async (query: Record<string, any>) => {
    ultimasLlamadasFindMany = [];
    const req = { query } as any;
    let respuestaFinal: any = null;
    let statusCode = 200;
    const res = {
      status: (code: number) => {
        statusCode = code;
        return res;
      },
      json: (data: any) => {
        respuestaFinal = data;
        return res;
      },
    } as any;

    await listarEntregasNotificacionSistema(req, res);
    return { status: statusCode, respuesta: respuestaFinal, findManyArgs: ultimasLlamadasFindMany[0] };
  };

  it('1. Dataset de 112 entregas: lote inicial de 100 registros con hayMas: true y siguienteCursor válido', async () => {
    datasetActual = crearDataset(112, 12);
    const { status, respuesta } = await ejecutarListar({ limite: '100' });

    expect(status).toBe(200);
    expect(respuesta.datos).toHaveLength(100);
    expect(respuesta.meta.total).toBe(112);
    expect(respuesta.meta.hayMas).toBe(true);
    expect(respuesta.meta.hasMore).toBe(true);
    expect(respuesta.meta.siguienteCursor).toBeTruthy();
  });

  it('2. Dataset de 112 entregas: Cargar más con cursor devuelve los 12 restantes y hayMas: false', async () => {
    datasetActual = crearDataset(112, 12);

    // Primer lote
    const { respuesta: res1 } = await ejecutarListar({ limite: '100' });
    const cursor = res1.meta.siguienteCursor;
    expect(cursor).toBe(res1.datos[99].id);

    // Segundo lote (Cargar más)
    const { status, respuesta: res2 } = await ejecutarListar({ cursor, limite: '100' });

    expect(status).toBe(200);
    expect(res2.datos).toHaveLength(12);
    expect(res2.meta.total).toBe(112);
    expect(res2.meta.hayMas).toBe(false);
    expect(res2.meta.siguienteCursor).toBeNull();

    // Acumulación sin duplicados
    const acumulados = [...res1.datos, ...res2.datos];
    expect(acumulados).toHaveLength(112);
    const idsUnicos = new Set(acumulados.map((item) => item.id));
    expect(idsUnicos.size).toBe(112);
  });

  it('3. Dataset de 350 entregas: carga secuencial de 100 -> 200 -> 300 -> 350 acumulando todo el historial', async () => {
    datasetActual = crearDataset(350, 0);

    // Lote 1 (0 -> 100)
    const { respuesta: lote1 } = await ejecutarListar({ limite: '100' });
    expect(lote1.datos).toHaveLength(100);
    expect(lote1.meta.hayMas).toBe(true);
    expect(lote1.meta.total).toBe(350);

    // Lote 2 (100 -> 200)
    const { respuesta: lote2 } = await ejecutarListar({ cursor: lote1.meta.siguienteCursor, limite: '100' });
    expect(lote2.datos).toHaveLength(100);
    expect(lote2.meta.hayMas).toBe(true);

    // Lote 3 (200 -> 300)
    const { respuesta: lote3 } = await ejecutarListar({ cursor: lote2.meta.siguienteCursor, limite: '100' });
    expect(lote3.datos).toHaveLength(100);
    expect(lote3.meta.hayMas).toBe(true);

    // Lote 4 (300 -> 350)
    const { respuesta: lote4 } = await ejecutarListar({ cursor: lote3.meta.siguienteCursor, limite: '100' });
    expect(lote4.datos).toHaveLength(50);
    expect(lote4.meta.hayMas).toBe(false);
    expect(lote4.meta.siguienteCursor).toBeNull();

    // Verificación de acumulado total
    const todos = [...lote1.datos, ...lote2.datos, ...lote3.datos, ...lote4.datos];
    expect(todos).toHaveLength(350);
    const setIds = new Set(todos.map((e) => e.id));
    expect(setIds.size).toBe(350);
  });

  it('4. Filtro por estado = FALLIDA calcula el total únicamente sobre el conjunto filtrado', async () => {
    datasetActual = crearDataset(112, 12);
    const { status, respuesta } = await ejecutarListar({
      estado: EstadoEntregaNotificacion.FALLIDA,
      limite: '100',
    });

    expect(status).toBe(200);
    expect(respuesta.datos).toHaveLength(12);
    expect(respuesta.meta.total).toBe(12);
    expect(respuesta.meta.hayMas).toBe(false);
    expect(respuesta.meta.siguienteCursor).toBeNull();

    respuesta.datos.forEach((entrega: any) => {
      expect(entrega.estado).toBe(EstadoEntregaNotificacion.FALLIDA);
    });
  });

  it('5. 100 no es un límite artificial del sistema: permite solicitar un tamaño de lote configurable', async () => {
    datasetActual = crearDataset(150, 0);
    const { respuesta } = await ejecutarListar({ limite: '150' });
    expect(respuesta.datos).toHaveLength(150);
    expect(respuesta.meta.hayMas).toBe(false);
    expect(respuesta.meta.total).toBe(150);
  });

  it('6. Orden determinista: entregas más recientes primero ({ creadoEn: desc }, { id: desc })', async () => {
    datasetActual = crearDataset(112, 12);
    const { respuesta, findManyArgs } = await ejecutarListar({ limite: '100' });

    expect(findManyArgs.orderBy).toEqual([{ creadoEn: 'desc' }, { id: 'desc' }]);
    expect(respuesta.datos[0].id).toBe(112);
    expect(respuesta.datos[1].id).toBe(111);

    for (let i = 0; i < respuesta.datos.length - 1; i++) {
      expect(respuesta.datos[i].id).toBeGreaterThan(respuesta.datos[i + 1].id);
    }
  });

  it('7. Compatibilidad hacia atrás con query parameters de offset (pagina y limite)', async () => {
    datasetActual = crearDataset(112, 12);
    const { status, respuesta } = await ejecutarListar({ pagina: '2', limite: '100' });

    expect(status).toBe(200);
    expect(respuesta.datos).toHaveLength(12);
    expect(respuesta.meta.total).toBe(112);
    expect(respuesta.meta.hayMas).toBe(false);
  });
});
