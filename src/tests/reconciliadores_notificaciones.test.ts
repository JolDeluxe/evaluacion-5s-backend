/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, test } from 'bun:test';
import {
  CanalNotificacion,
  EstadoAsignacionAuditoria,
  EstadoEntregaNotificacion,
  RolUsuario,
  TipoArea,
  TipoNotificacion,
} from '../generated/prisma/enums';
import { primerDiaHabilMes, mesAnteriorDe } from '../utils/periodos';
import { reconciliarAsignaciones } from '../modules/notificaciones/reconciliador-asignaciones';
import { reconciliarResultados } from '../modules/notificaciones/reconciliador-resultados';
import { esErrorPermanenteSmtp } from '../modules/notificaciones/helper';

describe('Utilidades de Fechas y Periodos', () => {
  test('primerDiaHabilMes: cuando el día 1 es lunes retorna el día 1', () => {
    const fecha = primerDiaHabilMes(2026, 6);
    expect(fecha.getFullYear()).toBe(2026);
    expect(fecha.getMonth()).toBe(5); // Junio
    expect(fecha.getDate()).toBe(1);
    expect(fecha.getDay()).toBe(1); // Lunes
  });

  test('primerDiaHabilMes: cuando el día 1 es sábado retorna el lunes 3', () => {
    const fecha = primerDiaHabilMes(2026, 8);
    expect(fecha.getFullYear()).toBe(2026);
    expect(fecha.getMonth()).toBe(7); // Agosto
    expect(fecha.getDate()).toBe(3); // Lunes 3
    expect(fecha.getDay()).toBe(1); // Lunes
  });

  test('primerDiaHabilMes: cuando el día 1 es domingo retorna el lunes 2', () => {
    const fecha = primerDiaHabilMes(2026, 3);
    expect(fecha.getFullYear()).toBe(2026);
    expect(fecha.getMonth()).toBe(2); // Marzo
    expect(fecha.getDate()).toBe(2); // Lunes 2
    expect(fecha.getDay()).toBe(1); // Lunes
  });

  test('mesAnteriorDe calcula correctamente mes anterior y cambio de año', () => {
    expect(mesAnteriorDe(2026, 9)).toEqual({ anio: 2026, mes: 8 });
    expect(mesAnteriorDe(2026, 1)).toEqual({ anio: 2025, mes: 12 });
  });
});

describe('Clasificación de Errores SMTP', () => {
  test('identifica responseCode 550/554 como errores permanentes', () => {
    expect(esErrorPermanenteSmtp({ responseCode: 550, message: 'Mailbox unavailable' })).toBe(true);
    expect(esErrorPermanenteSmtp({ responseCode: 554, message: 'Transaction failed' })).toBe(true);
  });

  test('identifica códigos Nodemailer EENVELOPE y EMESSAGE como permanentes', () => {
    expect(esErrorPermanenteSmtp({ code: 'EENVELOPE', message: 'No recipients' })).toBe(true);
    expect(esErrorPermanenteSmtp({ code: 'EMESSAGE', message: 'Message rejected' })).toBe(true);
  });

  test('identifica errores 4xx o temporales como NO permanentes', () => {
    expect(esErrorPermanenteSmtp({ responseCode: 421, message: 'Service not available' })).toBe(false);
    expect(esErrorPermanenteSmtp({ responseCode: 450, message: 'Mailbox busy' })).toBe(false);
    expect(esErrorPermanenteSmtp({ code: 'ETIMEDOUT', message: 'Connection timed out' })).toBe(false);
    expect(esErrorPermanenteSmtp({ code: 'ECONNREFUSED', message: 'Connection refused' })).toBe(false);
  });
});

class FakeDbTx {
  notificaciones: any[] = [];
  entregas: any[] = [];
  usuarios: any[] = [];
  areas: any[] = [];
  usuariosArea: any[] = [];
  objetivos: any[] = [];
  asignacionesMensuales: any[] = [];
  asignacionesAuditoria: any[] = [];

  area = {
    findMany: async () => this.areas,
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
    findMany: async (args: any) => {
      let res = [...this.usuarios];
      if (args?.where?.id?.in) {
        res = res.filter((u) => args.where.id.in.includes(u.id));
      }
      if (args?.where?.rol?.in) {
        res = res.filter((u) => args.where.rol.in.includes(u.rol));
      }
      if (args?.where?.activo !== undefined) {
        res = res.filter((u) => u.activo === args.where.activo);
      }
      return res.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
    },
  };

  usuarioArea = {
    findMany: async (args: any) => {
      let res = [...this.usuariosArea];
      if (args?.where?.areaId?.in) {
        res = res.filter((ua) => args.where.areaId.in.includes(ua.areaId));
      }
      if (args?.where?.usuarioId !== undefined) {
        res = res.filter((ua) => ua.usuarioId === args.where.usuarioId);
      }
      return res.map((ua) => ({
        ...ua,
        usuario: this.usuarios.find((u) => u.id === ua.usuarioId),
      }));
    },
  };

  objetivoAuditoria = {
    findMany: async (args: any) => {
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
          envioResultado: obj.envioResultado ? {
            ...obj.envioResultado,
            respuestasAuditoria: obj.envioResultado.respuestasAuditoria ?? [],
          } : null,
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
    create: async (args: any) => {
      const nuevo = { id: this.notificaciones.length + 1, ...args.data, creadoEn: new Date() };
      this.notificaciones.push(nuevo);
      return nuevo;
    },
  };

  entregaNotificacion = {
    create: async (args: any) => {
      const nueva = { id: this.entregas.length + 1, ...args.data, creadoEn: new Date() };
      this.entregas.push(nueva);
      return nueva;
    },
  };
}

describe('Reconciliador de Asignaciones Mensuales', () => {
  test('Recuperación tras apagón: si el backend estuvo apagado el primer día hábil (lunes), se recupera y crea el martes', async () => {
    const fakeTx = new FakeDbTx();

    fakeTx.usuarios = [
      { id: 10, nombre: 'Andrea Auditora', nombreUsuario: 'andrea', correo: 'andrea@empresa.com', activo: true, rol: RolUsuario.AUDITOR },
      { id: 11, nombre: 'Carlos Auditor', nombreUsuario: 'carlos', correo: 'carlos@empresa.com', activo: true, rol: RolUsuario.AUDITOR },
    ];

    fakeTx.areas = [
      { id: 1, codigo: 'A-1', nombre: 'BORDADO', tipo: TipoArea.OPERATIVA, activo: true, auditableDesde: null, auditableHasta: null, usuariosArea: [] },
      { id: 2, codigo: 'A-2', nombre: 'MANTENIMIENTO', tipo: TipoArea.OPERATIVA, activo: true, auditableDesde: null, auditableHasta: null, usuariosArea: [] },
      { id: 3, codigo: 'A-3', nombre: 'LASER', tipo: TipoArea.OPERATIVA, activo: true, auditableDesde: null, auditableHasta: null, usuariosArea: [] },
    ];

    // Objetivos del mes P1 y P2 para cada área
    fakeTx.objetivos = [
      { id: 1, areaId: 1, anio: 2026, mes: 9, periodo: 1, terminaEn: new Date('2026-09-15'), canceladoEn: null },
      { id: 2, areaId: 1, anio: 2026, mes: 9, periodo: 2, terminaEn: new Date('2026-09-30'), canceladoEn: null },
      { id: 3, areaId: 2, anio: 2026, mes: 9, periodo: 1, terminaEn: new Date('2026-09-15'), canceladoEn: null },
      { id: 4, areaId: 2, anio: 2026, mes: 9, periodo: 2, terminaEn: new Date('2026-09-30'), canceladoEn: null },
      { id: 5, areaId: 3, anio: 2026, mes: 9, periodo: 1, terminaEn: new Date('2026-09-15'), canceladoEn: null },
      { id: 6, areaId: 3, anio: 2026, mes: 9, periodo: 2, terminaEn: new Date('2026-09-30'), canceladoEn: null },
    ];

    // Asignaciones mensuales: Andrea tiene 2 áreas (BORDADO, MANTENIMIENTO), Carlos tiene 1 (LASER)
    fakeTx.asignacionesMensuales = [
      { id: 1, areaId: 1, anio: 2026, mes: 9, auditorId: 10 },
      { id: 2, areaId: 2, anio: 2026, mes: 9, auditorId: 10 },
      { id: 3, areaId: 3, anio: 2026, mes: 9, auditorId: 11 },
    ];

    fakeTx.asignacionesAuditoria = [
      { id: 1, objetivoAuditoriaId: 1, auditorId: 10, estado: EstadoAsignacionAuditoria.PENDIENTE, asignacionMensualId: 1 },
      { id: 2, objetivoAuditoriaId: 2, auditorId: 10, estado: EstadoAsignacionAuditoria.PENDIENTE, asignacionMensualId: 1 },
      { id: 3, objetivoAuditoriaId: 3, auditorId: 10, estado: EstadoAsignacionAuditoria.PENDIENTE, asignacionMensualId: 2 },
      { id: 4, objetivoAuditoriaId: 4, auditorId: 10, estado: EstadoAsignacionAuditoria.PENDIENTE, asignacionMensualId: 2 },
      { id: 5, objetivoAuditoriaId: 5, auditorId: 11, estado: EstadoAsignacionAuditoria.PENDIENTE, asignacionMensualId: 3 },
      { id: 6, objetivoAuditoriaId: 6, auditorId: 11, estado: EstadoAsignacionAuditoria.PENDIENTE, asignacionMensualId: 3 },
    ];

    // Septiembre 2026: primer día hábil fue martes 1 de septiembre.
    // El sistema estuvo apagado el 1 de septiembre y el reconciliador corre el miércoles 2 de septiembre.
    const miercoles2Sep = new Date('2026-09-02T10:00:00Z');

    const res1 = await reconciliarAsignaciones(fakeTx as any, 2026, 9, miercoles2Sep);

    // Debe haber creado notificaciones para 2 auditores
    expect(res1.creadas).toBe(2);
    expect(fakeTx.notificaciones.length).toBe(2);

    // Verificar consolidación de áreas para Andrea
    const notifAndrea = fakeTx.notificaciones.find((n) => n.usuarioId === 10);
    expect(notifAndrea).toBeDefined();
    expect(notifAndrea.tipo).toBe(TipoNotificacion.ASIGNACION_MENSUAL_CORREO);
    expect(notifAndrea.datos.areas).toEqual(['BORDADO', 'MANTENIMIENTO']);
    expect(notifAndrea.datos.urlMisAuditorias).toContain('/mis-auditorias');

    // Verificar entregas creadas
    expect(fakeTx.entregas.length).toBe(2);
    expect(fakeTx.entregas[0].estado).toBe(EstadoEntregaNotificacion.PENDIENTE);
    expect(fakeTx.entregas[0].canal).toBe(CanalNotificacion.CORREO);

    // Segunda ejecución: NO DUPLICA
    const res2 = await reconciliarAsignaciones(fakeTx as any, 2026, 9, miercoles2Sep);
    expect(res2.creadas).toBe(0);
    expect(res2.duplicadas).toBe(2);
    expect(fakeTx.notificaciones.length).toBe(2);
    expect(fakeTx.entregas.length).toBe(2);
  });

  test('Usuario sin correo: genera Notificación pero EntregaNotificacion queda CANCELADA', async () => {
    const fakeTx = new FakeDbTx();

    fakeTx.usuarios = [
      { id: 20, nombre: 'Sin Correo', nombreUsuario: 'sincorreo', correo: null, activo: true, rol: RolUsuario.AUDITOR },
    ];

    fakeTx.areas = [
      { id: 5, codigo: 'A-5', nombre: 'CORTE', tipo: TipoArea.OPERATIVA, activo: true, auditableDesde: null, auditableHasta: null, usuariosArea: [] },
    ];

    fakeTx.objetivos = [
      { id: 10, areaId: 5, anio: 2026, mes: 9, periodo: 1, terminaEn: new Date('2026-09-15'), canceladoEn: null },
      { id: 11, areaId: 5, anio: 2026, mes: 9, periodo: 2, terminaEn: new Date('2026-09-30'), canceladoEn: null },
    ];

    fakeTx.asignacionesMensuales = [
      { id: 5, areaId: 5, anio: 2026, mes: 9, auditorId: 20 },
    ];

    fakeTx.asignacionesAuditoria = [
      { id: 10, objetivoAuditoriaId: 10, auditorId: 20, estado: EstadoAsignacionAuditoria.PENDIENTE, asignacionMensualId: 5 },
      { id: 11, objetivoAuditoriaId: 11, auditorId: 20, estado: EstadoAsignacionAuditoria.PENDIENTE, asignacionMensualId: 5 },
    ];

    const res = await reconciliarAsignaciones(fakeTx as any, 2026, 9, new Date('2026-09-02T10:00:00Z'));
    expect(res.sinCorreo).toBe(1);
    expect(fakeTx.notificaciones.length).toBe(1);
    expect(fakeTx.entregas.length).toBe(1);
    expect(fakeTx.entregas[0].estado).toBe(EstadoEntregaNotificacion.CANCELADA);
    expect(fakeTx.entregas[0].ultimoError).toContain('no tiene correo');
  });
});

describe('Reconciliador de Resultados Mensuales', () => {
  test('Consolidación de áreas y envío a Administradores con y sin áreas', async () => {
    const fakeTx = new FakeDbTx();

    fakeTx.usuarios = [
      // Responsable de 2 áreas
      { id: 30, nombre: 'Andrea Resp', nombreUsuario: 'andrea_resp', correo: 'andrea.resp@empresa.com', activo: true, rol: RolUsuario.AUDITOR },
      // Administrador CON área propia
      { id: 31, nombre: 'Admin Con Area', nombreUsuario: 'admin_con_area', correo: 'admin.conarea@empresa.com', activo: true, rol: RolUsuario.ADMINISTRADOR },
      // Administrador SIN áreas
      { id: 32, nombre: 'Admin Sin Area', nombreUsuario: 'admin_sin_area', correo: 'admin.sinarea@empresa.com', activo: true, rol: RolUsuario.ADMINISTRADOR },
      // Auditor sin áreas (NO debe recibir)
      { id: 33, nombre: 'Auditor Suelto', nombreUsuario: 'auditor_suelto', correo: 'auditor.suelto@empresa.com', activo: true, rol: RolUsuario.AUDITOR },
    ];

    fakeTx.areas = [
      { id: 101, codigo: 'A-101', nombre: 'BORDADO', tipo: TipoArea.OPERATIVA, activo: true, auditableDesde: null, auditableHasta: null },
      { id: 102, codigo: 'A-102', nombre: 'MANTENIMIENTO', tipo: TipoArea.OPERATIVA, activo: true, auditableDesde: null, auditableHasta: null },
      { id: 103, codigo: 'A-103', nombre: 'ADMINISTRACION', tipo: TipoArea.ADMINISTRATIVA, activo: true, auditableDesde: null, auditableHasta: null },
    ];

    fakeTx.usuariosArea = [
      { usuarioId: 30, areaId: 101 },
      { usuarioId: 30, areaId: 102 },
      { usuarioId: 31, areaId: 103 },
    ];

    // Objetivos del mes anterior (agosto 2026) que ya pasaron días de gracia con resultados verificados
    fakeTx.objetivos = [
      {
        id: 101,
        areaId: 101,
        anio: 2026,
        mes: 8,
        periodo: 1,
        iniciaEn: new Date('2026-08-01T00:00:00Z'),
        terminaEn: new Date('2026-08-15T23:59:59Z'),
        canceladoEn: null,
        envioResultadoId: 1,
        envioResultado: { id: 1, verificadoEn: new Date('2026-08-14'), invalidadoEn: null, porcentaje: 98.0, respuestasAuditoria: [] },
      },
      {
        id: 102,
        areaId: 102,
        anio: 2026,
        mes: 8,
        periodo: 1,
        iniciaEn: new Date('2026-08-01T00:00:00Z'),
        terminaEn: new Date('2026-08-15T23:59:59Z'),
        canceladoEn: null,
        envioResultadoId: 2,
        envioResultado: { id: 2, verificadoEn: new Date('2026-08-14'), invalidadoEn: null, porcentaje: 92.0, respuestasAuditoria: [] },
      },
      {
        id: 103,
        areaId: 103,
        anio: 2026,
        mes: 8,
        periodo: 1,
        iniciaEn: new Date('2026-08-01T00:00:00Z'),
        terminaEn: new Date('2026-08-15T23:59:59Z'),
        canceladoEn: null,
        envioResultadoId: 3,
        envioResultado: { id: 3, verificadoEn: new Date('2026-08-14'), invalidadoEn: null, porcentaje: 95.0, respuestasAuditoria: [] },
      },
    ];

    // Fecha actual: 15 de septiembre 2026 (después de gracia de agosto)
    const fechaAhora = new Date('2026-09-15T10:00:00Z');

    const res = await reconciliarResultados(fakeTx as any, 2026, 8, fechaAhora);

    // Debe haber procesado a 3 usuarios: Andrea Resp (2 áreas), Admin Con Area (1 área), Admin Sin Area (0 áreas)
    // Auditor Suelto no debe haber recibido
    expect(res.creadas).toBe(3);
    expect(fakeTx.notificaciones.length).toBe(3);

    // 1. Andrea Resp: 2 áreas consolidadas
    const notifAndrea = fakeTx.notificaciones.find((n) => n.usuarioId === 30);
    expect(notifAndrea).toBeDefined();
    expect(notifAndrea.tipo).toBe(TipoNotificacion.RESULTADO_MENSUAL_CORREO);
    expect(notifAndrea.datos.areas.length).toBe(2);

    // 2. Admin Con Area: 1 correo único con sus áreas y resultado general (NO dos correos)
    const notifAdminConArea = fakeTx.notificaciones.filter((n) => n.usuarioId === 31);
    expect(notifAdminConArea.length).toBe(1);
    expect(notifAdminConArea[0].datos.areas.length).toBe(1);

    // 3. Admin Sin Area: 1 correo con resultado general y areas vacías
    const notifAdminSinArea = fakeTx.notificaciones.find((n) => n.usuarioId === 32);
    expect(notifAdminSinArea).toBeDefined();
    expect(notifAdminSinArea.datos.areas.length).toBe(0);

    // 4. Auditor Suelto: 0 notificaciones
    const notifAuditorSuelto = fakeTx.notificaciones.find((n) => n.usuarioId === 33);
    expect(notifAuditorSuelto).toBeUndefined();

    // Idempotencia: segunda ejecución no duplica
    const res2 = await reconciliarResultados(fakeTx as any, 2026, 8, fechaAhora);
    expect(res2.creadas).toBe(0);
    expect(res2.duplicadas).toBe(3);
  });
});