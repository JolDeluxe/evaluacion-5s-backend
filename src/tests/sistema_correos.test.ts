import { describe, expect, it } from 'bun:test';
import type { Request, Response } from 'express';
import { prisma } from '../db';
import { CanalNotificacion, EstadoEntregaNotificacion, RolUsuario, TipoNotificacion } from '../generated/prisma/enums';
import { hashSha256 } from '../utils/crypto';
import { reenviarEntregaCorreoSistema } from '../modules/sistema/08_reenviar_entrega';

const mockReq = (params: { id: string | number }, usuarioId = 1): Request => ({
  params: { id: String(params.id) },
  autenticacion: { usuarioId, rol: RolUsuario.SUPER_ADMIN },
} as unknown as Request);

interface MockResData {
  datos: {
    entrega: {
      id: number;
      estado: EstadoEntregaNotificacion;
      destinoSnapshot: string;
      notificacionId: number;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

const mockRes = () => {
  let status = 200;
  let respuestaJson: MockResData = {
    datos: {
      entrega: {
        id: 0,
        estado: EstadoEntregaNotificacion.PENDIENTE,
        destinoSnapshot: '',
        notificacionId: 0,
      },
    },
  };
  const res = {
    status: (s: number) => {
      status = s;
      return res;
    },
    json: (j: unknown) => {
      respuestaJson = j as MockResData;
      return res;
    },
  } as unknown as Response;
  return {
    res,
    get json() {
      return respuestaJson;
    },
    get status() {
      return status;
    },
  };
};

describe('Endpoints y Operaciones de Sistema — Correos (Semántica de Reenvío)', () => {
  it('reenviar entrega post-SENT crea nueva Notificación y Entrega sin duplicar claveDedupe previa', async () => {
    const timestamp = Date.now();
    const usuario = await prisma.usuario.create({
      data: {
        nombreUsuario: `user_reenvio_${timestamp}`,
        nombre: `Test Reenvío ${timestamp}`,
        correo: `test.reenvio.${timestamp}@example.com`,
        hashContrasena: 'hash-dummy',
        rol: RolUsuario.AUDITOR,
        activo: true,
      },
    });

    const notifOriginal = await prisma.notificacion.create({
      data: {
        usuarioId: usuario.id,
        claveDedupe: `asignacion-mensual-correo:${usuario.id}:2026-09`,
        tipo: TipoNotificacion.ASIGNACION_MENSUAL_CORREO,
        titulo: 'Auditorías asignadas — Septiembre 2026',
        mensaje: 'Mensaje de asignación original',
        datos: { templateName: 'audit_assignment_monthly', areas: ['BORDADO'] },
      },
    });

    const entregaOriginal = await prisma.entregaNotificacion.create({
      data: {
        notificacionId: notifOriginal.id,
        canal: CanalNotificacion.CORREO,
        estado: EstadoEntregaNotificacion.ENVIADA,
        destinoSnapshot: usuario.correo!,
        destinoHash: hashSha256(usuario.correo!),
        enviadoEn: new Date(),
        programadoEn: new Date(),
      },
    });

    const mRes = mockRes();
    await reenviarEntregaCorreoSistema(mockReq({ id: entregaOriginal.id }, usuario.id), mRes.res);

    expect(mRes.json).toBeDefined();
    expect(mRes.json.datos.entrega).toBeDefined();
    expect(mRes.json.datos.entrega.id).not.toBe(entregaOriginal.id);
    expect(mRes.json.datos.entrega.estado).toBe(EstadoEntregaNotificacion.PENDIENTE);
    expect(mRes.json.datos.entrega.destinoSnapshot).toBe(usuario.correo!);

    // Limpieza
    await prisma.entregaNotificacion.deleteMany({
      where: { id: { in: [entregaOriginal.id, mRes.json.datos.entrega.id] } },
    });
    await prisma.notificacion.deleteMany({
      where: { usuarioId: usuario.id },
    });
    await prisma.usuario.delete({ where: { id: usuario.id } });
  });

  it('1. mismo correo → reenvío al mismo correo con nueva entrega PENDIENTE', async () => {
    const ts = Date.now() + 100;
    const correoOriginal = `andrea.lopez.${ts}@cuadra.com.mx`;

    const usuario = await prisma.usuario.create({
      data: {
        nombreUsuario: `andrea_${ts}`,
        nombre: 'Andrea López',
        correo: correoOriginal,
        hashContrasena: 'hash-dummy',
        rol: RolUsuario.AUDITOR,
        activo: true,
      },
    });

    const notif = await prisma.notificacion.create({
      data: {
        usuarioId: usuario.id,
        claveDedupe: `dedupe:test:${ts}`,
        tipo: TipoNotificacion.RECORDATORIO,
        titulo: 'Recordatorio P1',
        mensaje: 'Tienes auditorías pendientes',
      },
    });

    const entregaOriginal = await prisma.entregaNotificacion.create({
      data: {
        notificacionId: notif.id,
        canal: CanalNotificacion.CORREO,
        estado: EstadoEntregaNotificacion.ENVIADA,
        destinoSnapshot: correoOriginal,
        destinoHash: hashSha256(correoOriginal),
        programadoEn: new Date('2026-09-01T10:00:00Z'),
        enviadoEn: new Date('2026-09-01T10:01:00Z'),
        intentos: 1,
      },
    });

    const mRes = mockRes();
    await reenviarEntregaCorreoSistema(mockReq({ id: entregaOriginal.id }, usuario.id), mRes.res);

    expect(mRes.json.datos.entrega.id).not.toBe(entregaOriginal.id);
    expect(mRes.json.datos.entrega.estado).toBe(EstadoEntregaNotificacion.PENDIENTE);
    expect(mRes.json.datos.entrega.destinoSnapshot).toBe(correoOriginal);
    expect(mRes.json.datos.cambioDestino).toBe(false);

    // Limpieza
    await prisma.entregaNotificacion.deleteMany({ where: { id: { in: [entregaOriginal.id, mRes.json.datos.entrega.id] } } });
    await prisma.notificacion.deleteMany({ where: { usuarioId: usuario.id } });
    await prisma.usuario.delete({ where: { id: usuario.id } });
  });

  it('2. correo cambiado → reenvío al ACTUAL con nuevo ID y nuevo destinoSnapshot', async () => {
    const ts = Date.now() + 200;
    const correoViejo = `andrea.lopez.${ts}@cuadra.com.mx`;
    const correoNuevo = `andrea.nueva.${ts}@cuadra.com.mx`;

    const usuario = await prisma.usuario.create({
      data: {
        nombreUsuario: `andrea_cambio_${ts}`,
        nombre: 'Andrea López',
        correo: correoViejo,
        hashContrasena: 'hash-dummy',
        rol: RolUsuario.AUDITOR,
        activo: true,
      },
    });

    const notif = await prisma.notificacion.create({
      data: {
        usuarioId: usuario.id,
        claveDedupe: `dedupe:cambio:${ts}`,
        tipo: TipoNotificacion.RESULTADO_MENSUAL_CORREO,
        titulo: 'Resultados Agosto 2026',
        mensaje: 'Resultados disponibles',
      },
    });

    const fechaEnvioOriginal = new Date('2026-09-01T08:00:00Z');
    const entregaOriginal = await prisma.entregaNotificacion.create({
      data: {
        notificacionId: notif.id,
        canal: CanalNotificacion.CORREO,
        estado: EstadoEntregaNotificacion.ENVIADA,
        destinoSnapshot: correoViejo,
        destinoHash: hashSha256(correoViejo),
        programadoEn: fechaEnvioOriginal,
        enviadoEn: fechaEnvioOriginal,
        intentos: 1,
      },
    });

    // Administrador actualiza el correo de Andrea en Usuarios
    await prisma.usuario.update({
      where: { id: usuario.id },
      data: { correo: correoNuevo },
    });

    // Se ejecuta Reenviar
    const mRes = mockRes();
    await reenviarEntregaCorreoSistema(mockReq({ id: entregaOriginal.id }, usuario.id), mRes.res);

    const nuevaEntrega = mRes.json.datos.entrega;
    expect(nuevaEntrega.id).not.toBe(entregaOriginal.id);
    expect(nuevaEntrega.estado).toBe(EstadoEntregaNotificacion.PENDIENTE);
    expect(nuevaEntrega.destinoSnapshot).toBe(correoNuevo);
    expect(nuevaEntrega.destinoHash).toBe(hashSha256(correoNuevo));
    expect(mRes.json.datos.destinoOriginal).toBe(correoViejo);
    expect(mRes.json.datos.destinoActual).toBe(correoNuevo);
    expect(mRes.json.datos.cambioDestino).toBe(true);

    // 5. original permanece 100% intacta
    const originalEnBd = await prisma.entregaNotificacion.findUniqueOrThrow({
      where: { id: entregaOriginal.id },
    });
    expect(originalEnBd.estado).toBe(EstadoEntregaNotificacion.ENVIADA);
    expect(originalEnBd.destinoSnapshot).toBe(correoViejo);
    expect(originalEnBd.destinoHash).toBe(hashSha256(correoViejo));
    expect(originalEnBd.enviadoEn?.toISOString()).toBe(fechaEnvioOriginal.toISOString());
    expect(originalEnBd.intentos).toBe(1);

    // Limpieza
    await prisma.entregaNotificacion.deleteMany({ where: { id: { in: [entregaOriginal.id, nuevaEntrega.id] } } });
    await prisma.notificacion.deleteMany({ where: { usuarioId: usuario.id } });
    await prisma.usuario.delete({ where: { id: usuario.id } });
  });

  it('3. sin correo actual (null o vacío) → bloqueado con error explicativo', async () => {
    const ts = Date.now() + 300;
    const correoViejo = `andrea.sincorreo.${ts}@cuadra.com.mx`;

    const usuario = await prisma.usuario.create({
      data: {
        nombreUsuario: `andrea_null_${ts}`,
        nombre: 'Andrea Sin Correo',
        correo: correoViejo,
        hashContrasena: 'hash-dummy',
        rol: RolUsuario.AUDITOR,
        activo: true,
      },
    });

    const notif = await prisma.notificacion.create({
      data: {
        usuarioId: usuario.id,
        claveDedupe: `dedupe:null:${ts}`,
        tipo: TipoNotificacion.ASIGNACION_MENSUAL_CORREO,
        titulo: 'Asignaciones',
        mensaje: 'Mensaje',
      },
    });

    const entregaOriginal = await prisma.entregaNotificacion.create({
      data: {
        notificacionId: notif.id,
        canal: CanalNotificacion.CORREO,
        estado: EstadoEntregaNotificacion.ENVIADA,
        destinoSnapshot: correoViejo,
        destinoHash: hashSha256(correoViejo),
        programadoEn: new Date(),
        enviadoEn: new Date(),
        intentos: 1,
      },
    });

    // Se le retira el correo al usuario
    await prisma.usuario.update({
      where: { id: usuario.id },
      data: { correo: null },
    });

    const { res } = mockRes();
    await expect(
      reenviarEntregaCorreoSistema(mockReq({ id: entregaOriginal.id }), res)
    ).rejects.toThrow(/no tiene una dirección de correo configurada actualmente/i);

    // Limpieza
    await prisma.entregaNotificacion.deleteMany({ where: { id: entregaOriginal.id } });
    await prisma.notificacion.deleteMany({ where: { usuarioId: usuario.id } });
    await prisma.usuario.delete({ where: { id: usuario.id } });
  });

  it('4. usuario inactivo o dado de baja → bloqueado con error explicativo', async () => {
    const ts = Date.now() + 400;
    const correoViejo = `andrea.inactiva.${ts}@cuadra.com.mx`;

    const usuario = await prisma.usuario.create({
      data: {
        nombreUsuario: `andrea_inactiva_${ts}`,
        nombre: 'Andrea Inactiva',
        correo: correoViejo,
        hashContrasena: 'hash-dummy',
        rol: RolUsuario.AUDITOR,
        activo: true,
      },
    });

    const notif = await prisma.notificacion.create({
      data: {
        usuarioId: usuario.id,
        claveDedupe: `dedupe:inactiva:${ts}`,
        tipo: TipoNotificacion.ASIGNACION_MENSUAL_CORREO,
        titulo: 'Asignaciones',
        mensaje: 'Mensaje',
      },
    });

    const entregaOriginal = await prisma.entregaNotificacion.create({
      data: {
        notificacionId: notif.id,
        canal: CanalNotificacion.CORREO,
        estado: EstadoEntregaNotificacion.ENVIADA,
        destinoSnapshot: correoViejo,
        destinoHash: hashSha256(correoViejo),
        programadoEn: new Date(),
        enviadoEn: new Date(),
        intentos: 1,
      },
    });

    // El usuario es dado de baja (activo = false)
    await prisma.usuario.update({
      where: { id: usuario.id },
      data: { activo: false },
    });

    const { res } = mockRes();
    await expect(
      reenviarEntregaCorreoSistema(mockReq({ id: entregaOriginal.id }), res)
    ).rejects.toThrow(/está inactivo o dado de baja/i);

    // Limpieza
    await prisma.entregaNotificacion.deleteMany({ where: { id: entregaOriginal.id } });
    await prisma.notificacion.deleteMany({ where: { usuarioId: usuario.id } });
    await prisma.usuario.delete({ where: { id: usuario.id } });
  });
});