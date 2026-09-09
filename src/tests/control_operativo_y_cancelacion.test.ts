/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, test } from 'bun:test';
import {
  EstadoAsignacionAuditoria,
  EstadoEntregaNotificacion,
  RolUsuario,
  TipoArea,
} from '../generated/prisma/enums';
import {
  actualizarEstadoControlOperativo,
  obtenerEstadoControlOperativo,
} from '../modules/notificaciones/control-operativo';
import { reconciliarAsignaciones } from '../modules/notificaciones/reconciliador-asignaciones';

class FakeDbControlTx {
  secretos: Array<{ clave: string; valorCifrado: string; actualizadoEn: Date; metadatos: any }> = [];
  usuarios: any[] = [];
  areas: any[] = [];
  usuariosArea: any[] = [];
  objetivos: any[] = [];
  asignacionesMensuales: any[] = [];
  asignacionesAuditoria: any[] = [];
  notificaciones: any[] = [];
  entregas: any[] = [];

  secretoSistema = {
    findUnique: async (args: any) => {
      return this.secretos.find((s) => s.clave === args.where.clave) || null;
    },
    upsert: async (args: any) => {
      const idx = this.secretos.findIndex((s) => s.clave === args.where.clave);
      const record = {
        clave: args.where.clave,
        valorCifrado: args.update.valorCifrado,
        metadatos: args.update.metadatos,
        actualizadoEn: new Date(),
      };
      if (idx >= 0) {
        this.secretos[idx] = record;
      } else {
        this.secretos.push(record);
      }
      return record;
    },
  };

  asignacionMensual = {
    findMany: async ({ where }: any) =>
      this.asignacionesMensuales
        .filter((a) => a.anio === where.anio && a.mes === where.mes)
        .map((a) => ({
          ...a,
          auditor: this.usuarios.find((u) => u.id === a.auditorId),
        })),
  };

  usuario = {
    findMany: async (args?: any) => {
      let res = [...this.usuarios];
      if (args?.where?.id?.in) {
        res = res.filter((u) => args.where.id.in.includes(u.id));
      }
      return res;
    },
  };

  area = {
    findMany: async (args?: any) => {
      let res = [...this.areas];
      if (args?.where?.activo !== undefined) {
        res = res.filter((a) => a.activo === args.where.activo);
      }
      return res.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
    },
  };

  usuarioArea = {
    findMany: async (args?: any) => {
      let res = [...this.usuariosArea];
      if (args?.where?.areaId?.in) {
        res = res.filter((ua) => args.where.areaId.in.includes(ua.areaId));
      }
      return res.map((ua) => ({
        ...ua,
        usuario: this.usuarios.find((u) => u.id === ua.usuarioId),
      }));
    },
  };

  objetivoAuditoria = {
    findMany: async (args?: any) => {
      let res = [...this.objetivos];
      if (args?.where?.anio !== undefined) res = res.filter((o) => o.anio === args.where.anio);
      if (args?.where?.mes !== undefined) res = res.filter((o) => o.mes === args.where.mes);
      if (args?.where?.canceladoEn === null) res = res.filter((o) => o.canceladoEn === null);
      if (args?.where?.periodo?.in) res = res.filter((o) => args.where.periodo.in.includes(o.periodo));
      return res.map((obj) => {
        const area = this.areas.find((a) => a.id === obj.areaId);
        return {
          ...obj,
          iniciaEn: obj.iniciaEn ?? new Date('2026-09-01'),
          terminaEn: obj.terminaEn ?? new Date('2026-09-15'),
          tipoAreaSnapshot: obj.tipoAreaSnapshot ?? area?.tipo ?? TipoArea.OPERATIVA,
          nombreAreaSnapshot: obj.nombreAreaSnapshot ?? area?.nombre ?? `Area ${obj.areaId}`,
          codigoAreaSnapshot: obj.codigoAreaSnapshot ?? area?.codigo ?? `A-${obj.areaId}`,
          area: area ? {
            ...area,
            usuariosArea: this.usuariosArea.filter((ua) => ua.areaId === area.id).map((ua) => ({ usuarioId: ua.usuarioId })),
          } : { id: obj.areaId, nombre: `Area ${obj.areaId}`, codigo: `A-${obj.areaId}`, tipo: TipoArea.OPERATIVA, usuariosArea: [] },
          envioResultado: obj.envioResultado ?? null,
          enviosAuditoria: obj.enviosAuditoria ?? [],
          asignacionesAuditoria: this.asignacionesAuditoria
            .filter((asig) => asig.objetivoAuditoriaId === obj.id)
            .map((asig) => ({
              ...asig,
              auditor: this.usuarios.find((u) => u.id === asig.auditorId) ?? null,
              asignacionMensual: this.asignacionesMensuales.find((am) => am.id === asig.asignacionMensualId) ?? null,
            })),
        };
      });
    },
  };

  notificacion = {
    findUnique: async (args: any) => {
      return this.notificaciones.find((n) => n.claveDedupe === args.where.claveDedupe) || null;
    },
    findMany: async (args?: any) => {
      let res = [...this.notificaciones];
      if (args?.where?.usuarioId !== undefined) {
        res = res.filter((n) => n.usuarioId === args.where.usuarioId);
      }
      if (args?.where?.tipo !== undefined) {
        res = res.filter((n) => n.tipo === args.where.tipo);
      }
      return res.sort((a, b) => (b.creadoEn?.getTime() || 0) - (a.creadoEn?.getTime() || 0));
    },
    create: async (args: any) => {
      const nuevo = { id: this.notificaciones.length + 1, ...args.data, creadoEn: new Date() };
      this.notificaciones.push(nuevo);
      return nuevo;
    },
    update: async (args: any) => {
      const idx = this.notificaciones.findIndex((n) => n.id === args.where.id);
      if (idx === -1) throw new Error('Notificacion no encontrada');
      this.notificaciones[idx] = { ...this.notificaciones[idx], ...args.data };
      return this.notificaciones[idx];
    },
  };

  entregaNotificacion = {
    findMany: async (args?: any) => {
      let res = [...this.entregas];
      if (args?.where?.notificacionId?.in) {
        res = res.filter((e) => args.where.notificacionId.in.includes(e.notificacionId));
      }
      return res;
    },
    create: async (args: any) => {
      const nueva = { id: this.entregas.length + 1, ...args.data, creadoEn: new Date() };
      this.entregas.push(nueva);
      return nueva;
    },
    update: async (args: any) => {
      const idx = this.entregas.findIndex((e) => e.id === args.where.id);
      if (idx === -1) throw new Error('Entrega no encontrada');
      this.entregas[idx] = { ...this.entregas[idx], ...args.data };
      return this.entregas[idx];
    },
  };
}

describe('Control Operativo de Correos — Fail-Safe', () => {
  test('1. Si no existe registro en SecretoSistema, retorna PAUSADO por defecto (fail-safe)', async () => {
    const fakeTx = new FakeDbControlTx();
    const info = await obtenerEstadoControlOperativo(fakeTx as any);
    expect(info.estado).toBe('PAUSADO');
  });

  test('2. Si el registro tiene JSON corrupto o inválido, retorna PAUSADO (fail-safe)', async () => {
    const fakeTx = new FakeDbControlTx();
    fakeTx.secretos.push({
      clave: 'control_operativo_correos',
      valorCifrado: '{ estado: corrupto, sin_comillas',
      actualizadoEn: new Date(),
      metadatos: {},
    });

    const info = await obtenerEstadoControlOperativo(fakeTx as any);
    expect(info.estado).toBe('PAUSADO');
  });

  test('3. Si el registro almacena un estado no reconocido, retorna PAUSADO (fail-safe)', async () => {
    const fakeTx = new FakeDbControlTx();
    fakeTx.secretos.push({
      clave: 'control_operativo_correos',
      valorCifrado: JSON.stringify({ estado: 'ESTADO_INVENTADO' }),
      actualizadoEn: new Date(),
      metadatos: {},
    });

    const info = await obtenerEstadoControlOperativo(fakeTx as any);
    expect(info.estado).toBe('PAUSADO');
  });

  test('4. Si ocurre una excepción al consultar la base de datos, retorna PAUSADO (fail-safe)', async () => {
    const brokenTx = {
      secretoSistema: {
        findUnique: async () => {
          throw new Error('Database connection lost');
        },
      },
    };

    const info = await obtenerEstadoControlOperativo(brokenTx as any);
    expect(info.estado).toBe('PAUSADO');
  });

  test('5. Solo con una acción explícita pasa a ACTIVO', async () => {
    const fakeTx = new FakeDbControlTx();
    await actualizarEstadoControlOperativo('ACTIVO', 1, 'Reanudación aprobada', fakeTx as any);

    const info = await obtenerEstadoControlOperativo(fakeTx as any);
    expect(info.estado).toBe('ACTIVO');
    expect(info.actualizadoPorId).toBe(1);
    expect(info.motivo).toBe('Reanudación aprobada');
  });

  test('6. Puede pausarse nuevamente de forma explícita', async () => {
    const fakeTx = new FakeDbControlTx();
    await actualizarEstadoControlOperativo('ACTIVO', 1, 'Reanudación', fakeTx as any);
    await actualizarEstadoControlOperativo('PAUSADO', 2, 'Mantenimiento preventivo', fakeTx as any);

    const info = await obtenerEstadoControlOperativo(fakeTx as any);
    expect(info.estado).toBe('PAUSADO');
    expect(info.actualizadoPorId).toBe(2);
    expect(info.motivo).toBe('Mantenimiento preventivo');
  });
});

describe('Consolidación Idempotente y Detección de Cambios en Asignaciones', () => {
  test('1. Asignación inicial crea notificación con fingerprint y entrega PENDIENTE', async () => {
    const fakeTx = new FakeDbControlTx();

    fakeTx.usuarios = [
      { id: 10, nombre: 'Auditor Uno', correo: 'auditor1@empresa.com', activo: true, rol: RolUsuario.AUDITOR },
    ];
    fakeTx.areas = [
      { id: 1, codigo: 'A-1', nombre: 'CORTE', tipo: TipoArea.OPERATIVA, activo: true, auditableDesde: null, auditableHasta: null, usuariosArea: [] },
      { id: 2, codigo: 'A-2', nombre: 'BORDADO', tipo: TipoArea.OPERATIVA, activo: true, auditableDesde: null, auditableHasta: null, usuariosArea: [] },
    ];
    fakeTx.objetivos = [
      { id: 1, areaId: 1, anio: 2026, mes: 9, periodo: 1, terminaEn: new Date('2026-09-15'), canceladoEn: null },
      { id: 2, areaId: 1, anio: 2026, mes: 9, periodo: 2, terminaEn: new Date('2026-09-30'), canceladoEn: null },
      { id: 3, areaId: 2, anio: 2026, mes: 9, periodo: 1, terminaEn: new Date('2026-09-15'), canceladoEn: null },
      { id: 4, areaId: 2, anio: 2026, mes: 9, periodo: 2, terminaEn: new Date('2026-09-30'), canceladoEn: null },
    ];
    fakeTx.asignacionesMensuales = [
      { id: 1, areaId: 1, anio: 2026, mes: 9, auditorId: 10 },
      { id: 2, areaId: 2, anio: 2026, mes: 9, auditorId: 10 },
    ];
    fakeTx.asignacionesAuditoria = [
      { id: 1, objetivoAuditoriaId: 1, auditorId: 10, estado: EstadoAsignacionAuditoria.PENDIENTE, asignacionMensualId: 1 },
      { id: 2, objetivoAuditoriaId: 2, auditorId: 10, estado: EstadoAsignacionAuditoria.PENDIENTE, asignacionMensualId: 1 },
      { id: 3, objetivoAuditoriaId: 3, auditorId: 10, estado: EstadoAsignacionAuditoria.PENDIENTE, asignacionMensualId: 2 },
      { id: 4, objetivoAuditoriaId: 4, auditorId: 10, estado: EstadoAsignacionAuditoria.PENDIENTE, asignacionMensualId: 2 },
    ];

    const fechaSimulada = new Date('2026-09-02T10:00:00Z');
    const res1 = await reconciliarAsignaciones(fakeTx as any, 2026, 9, fechaSimulada);

    expect(res1.creadas).toBe(1);
    expect(res1.actualizadas).toBe(0);
    expect(fakeTx.notificaciones.length).toBe(1);
    expect(fakeTx.entregas.length).toBe(1);

    const notif = fakeTx.notificaciones[0];
    expect(notif.datos.esActualizacion).toBe(false);
    expect(notif.datos.areas).toEqual(['BORDADO', 'CORTE']);
    expect(typeof notif.datos.areasFingerprint).toBe('string');
  });

  test('2. Segunda reconciliación idéntica: detecta fingerprint igual y no agrega entregas (duplicada)', async () => {
    const fakeTx = new FakeDbControlTx();
    fakeTx.usuarios = [{ id: 10, nombre: 'Auditor Uno', correo: 'auditor1@empresa.com', activo: true, rol: RolUsuario.AUDITOR }];
    fakeTx.areas = [{ id: 1, codigo: 'A-1', nombre: 'CORTE', tipo: TipoArea.OPERATIVA, activo: true, auditableDesde: null, auditableHasta: null, usuariosArea: [] }];
    fakeTx.objetivos = [{ id: 1, areaId: 1, anio: 2026, mes: 9, periodo: 1, terminaEn: new Date('2026-09-15'), canceladoEn: null }];
    fakeTx.asignacionesMensuales = [{ id: 1, areaId: 1, anio: 2026, mes: 9, auditorId: 10 }];
    fakeTx.asignacionesAuditoria = [{ id: 1, objetivoAuditoriaId: 1, auditorId: 10, estado: EstadoAsignacionAuditoria.PENDIENTE, asignacionMensualId: 1 }];

    const fechaSimulada = new Date('2026-09-02T10:00:00Z');
    await reconciliarAsignaciones(fakeTx as any, 2026, 9, fechaSimulada);
    const res2 = await reconciliarAsignaciones(fakeTx as any, 2026, 9, fechaSimulada);

    expect(res2.creadas).toBe(0);
    expect(res2.actualizadas).toBe(0);
    expect(res2.duplicadas).toBe(1);
    expect(fakeTx.entregas.length).toBe(1);
  });

  test('3. Cambio de áreas con entrega PENDIENTE: consolida en la misma entrega sin crear filas adicionales', async () => {
    const fakeTx = new FakeDbControlTx();
    fakeTx.usuarios = [{ id: 10, nombre: 'Auditor Uno', correo: 'auditor1@empresa.com', activo: true, rol: RolUsuario.AUDITOR }];
    fakeTx.areas = [
      { id: 1, codigo: 'A-1', nombre: 'CORTE', tipo: TipoArea.OPERATIVA, activo: true, auditableDesde: null, auditableHasta: null, usuariosArea: [] },
      { id: 2, codigo: 'A-2', nombre: 'ALMACEN', tipo: TipoArea.OPERATIVA, activo: true, auditableDesde: null, auditableHasta: null, usuariosArea: [] },
    ];
    fakeTx.objetivos = [
      { id: 1, areaId: 1, anio: 2026, mes: 9, periodo: 1, terminaEn: new Date('2026-09-15'), canceladoEn: null },
      { id: 2, areaId: 2, anio: 2026, mes: 9, periodo: 1, terminaEn: new Date('2026-09-15'), canceladoEn: null },
    ];

    // Asignación inicial: solo CORTE
    fakeTx.asignacionesMensuales = [{ id: 1, areaId: 1, anio: 2026, mes: 9, auditorId: 10 }];
    fakeTx.asignacionesAuditoria = [{ id: 1, objetivoAuditoriaId: 1, auditorId: 10, estado: EstadoAsignacionAuditoria.PENDIENTE, asignacionMensualId: 1 }];

    const fecha1 = new Date('2026-09-02T10:00:00Z');
    await reconciliarAsignaciones(fakeTx as any, 2026, 9, fecha1);
    expect(fakeTx.entregas.length).toBe(1);
    expect(fakeTx.notificaciones[0].datos.areas).toEqual(['CORTE']);

    // Se agrega ALMACEN a las asignaciones antes de que el worker despache la entrega PENDIENTE
    fakeTx.asignacionesMensuales.push({ id: 2, areaId: 2, anio: 2026, mes: 9, auditorId: 10 });
    fakeTx.asignacionesAuditoria.push({ id: 2, objetivoAuditoriaId: 2, auditorId: 10, estado: EstadoAsignacionAuditoria.PENDIENTE, asignacionMensualId: 2 });

    const fecha2 = new Date('2026-09-02T11:00:00Z');
    const resConsolidacion = await reconciliarAsignaciones(fakeTx as any, 2026, 9, fecha2);

    expect(resConsolidacion.creadas).toBe(0);
    expect(resConsolidacion.actualizadas).toBe(1);

    // Debe seguir habiendo EXACTAMENTE 1 entrega (consolidación sin filas huérfanas)
    expect(fakeTx.entregas.length).toBe(1);
    // La notificación asociada debe haber sido actualizada con las dos áreas ordenadas
    expect(fakeTx.notificaciones[0].datos.areas).toEqual(['ALMACEN', 'CORTE']);
  });

  test('4. Cambio de áreas cuando la previa ya fue ENVIADA: genera una nueva versión de actualización', async () => {
    const fakeTx = new FakeDbControlTx();
    fakeTx.usuarios = [{ id: 10, nombre: 'Auditor Uno', correo: 'auditor1@empresa.com', activo: true, rol: RolUsuario.AUDITOR }];
    fakeTx.areas = [
      { id: 1, codigo: 'A-1', nombre: 'CORTE', tipo: TipoArea.OPERATIVA, activo: true, auditableDesde: null, auditableHasta: null, usuariosArea: [] },
      { id: 2, codigo: 'A-2', nombre: 'EMPAQUE', tipo: TipoArea.OPERATIVA, activo: true, auditableDesde: null, auditableHasta: null, usuariosArea: [] },
    ];
    fakeTx.objetivos = [
      { id: 1, areaId: 1, anio: 2026, mes: 9, periodo: 1, terminaEn: new Date('2026-09-15'), canceladoEn: null },
      { id: 2, areaId: 2, anio: 2026, mes: 9, periodo: 1, terminaEn: new Date('2026-09-15'), canceladoEn: null },
    ];
    fakeTx.asignacionesMensuales = [{ id: 1, areaId: 1, anio: 2026, mes: 9, auditorId: 10 }];
    fakeTx.asignacionesAuditoria = [{ id: 1, objetivoAuditoriaId: 1, auditorId: 10, estado: EstadoAsignacionAuditoria.PENDIENTE, asignacionMensualId: 1 }];

    const fecha1 = new Date('2026-09-02T10:00:00Z');
    await reconciliarAsignaciones(fakeTx as any, 2026, 9, fecha1);

    // Simular que el correo inicial fue despachado y pasó a ENVIADA
    fakeTx.entregas[0].estado = EstadoEntregaNotificacion.ENVIADA;

    // Cambiar asignaciones a CORTE y EMPAQUE
    fakeTx.asignacionesMensuales.push({ id: 2, areaId: 2, anio: 2026, mes: 9, auditorId: 10 });
    fakeTx.asignacionesAuditoria.push({ id: 2, objetivoAuditoriaId: 2, auditorId: 10, estado: EstadoAsignacionAuditoria.PENDIENTE, asignacionMensualId: 2 });

    const fecha2 = new Date('2026-09-02T14:00:00Z');
    const resNuevaVersion = await reconciliarAsignaciones(fakeTx as any, 2026, 9, fecha2);

    expect(resNuevaVersion.creadas).toBe(1);
    expect(fakeTx.entregas.length).toBe(2);
    expect(fakeTx.notificaciones.length).toBe(2);

    const notifActualizacion = fakeTx.notificaciones[1];
    expect(notifActualizacion.datos.esActualizacion).toBe(true);
    expect(notifActualizacion.titulo).toContain('Actualización de asignaciones');
  });

  test('5. Cancelación de entrega: al cancelar, la clave dedupe permanece y el reconciliador no vuelve a crear la entrega', async () => {
    const fakeTx = new FakeDbControlTx();
    fakeTx.usuarios = [{ id: 10, nombre: 'Auditor Uno', correo: 'auditor1@empresa.com', activo: true, rol: RolUsuario.AUDITOR }];
    fakeTx.areas = [{ id: 1, codigo: 'A-1', nombre: 'CORTE', tipo: TipoArea.OPERATIVA, activo: true, auditableDesde: null, auditableHasta: null, usuariosArea: [] }];
    fakeTx.objetivos = [{ id: 1, areaId: 1, anio: 2026, mes: 9, periodo: 1, terminaEn: new Date('2026-09-15'), canceladoEn: null }];
    fakeTx.asignacionesMensuales = [{ id: 1, areaId: 1, anio: 2026, mes: 9, auditorId: 10 }];
    fakeTx.asignacionesAuditoria = [{ id: 1, objetivoAuditoriaId: 1, auditorId: 10, estado: EstadoAsignacionAuditoria.PENDIENTE, asignacionMensualId: 1 }];

    const fecha = new Date('2026-09-02T10:00:00Z');
    await reconciliarAsignaciones(fakeTx as any, 2026, 9, fecha);

    // Cancelar la entrega manualmente
    fakeTx.entregas[0].estado = EstadoEntregaNotificacion.CANCELADA;
    fakeTx.entregas[0].ultimoError = 'Cancelada manualmente por SUPER_ADMIN';

    // Ejecutar reconciliador de nuevo
    const resReintento = await reconciliarAsignaciones(fakeTx as any, 2026, 9, fecha);

    // No debe recrearse
    expect(resReintento.creadas).toBe(0);
    expect(resReintento.duplicadas).toBe(1);
    expect(fakeTx.entregas.length).toBe(1);
    expect(fakeTx.entregas[0].estado).toBe(EstadoEntregaNotificacion.CANCELADA);
  });
});
