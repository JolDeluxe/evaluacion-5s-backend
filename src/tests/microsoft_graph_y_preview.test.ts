import { describe, expect, it } from 'bun:test';
import { prisma } from '../db';
import { CanalNotificacion, EstadoEntregaNotificacion, RolUsuario, TipoNotificacion } from '../generated/prisma/enums';
import { procesarEntregasPendientes } from '../modules/notificaciones/worker';
import { construirMensajeMime } from '../modules/notificaciones/proveedores/mime-builder';
import { env } from '../config/env';

describe('Microsoft Graph, Worker Pause & Email Preview', () => {
  it('cuando EMAIL_ENABLED=false, el worker NO procesa entregas de correo y permanecen PENDIENTE', async () => {
    // 1. Crear usuario de prueba
    const timestamp = Date.now();
    const usuario = await prisma.usuario.create({
      data: {
        nombreUsuario: `user_pause_${timestamp}`,
        nombre: `Test Pause ${timestamp}`,
        correo: `test.pause.${timestamp}@example.com`,
        hashContrasena: 'hash-dummy',
        rol: RolUsuario.AUDITOR,
        activo: true,
      },
    });

    const notif = await prisma.notificacion.create({
      data: {
        usuarioId: usuario.id,
        claveDedupe: `test-pause:${usuario.id}:${timestamp}`,
        tipo: TipoNotificacion.ASIGNACION_MENSUAL_CORREO,
        titulo: 'Auditorías asignadas — Test',
        mensaje: 'Mensaje de prueba',
        datos: { templateName: 'audit_assignment_monthly', areas: ['BORDADO'] },
      },
    });

    const entrega = await prisma.entregaNotificacion.create({
      data: {
        notificacionId: notif.id,
        canal: CanalNotificacion.CORREO,
        estado: EstadoEntregaNotificacion.PENDIENTE,
        destinoSnapshot: usuario.correo!,
        programadoEn: new Date(Date.now() - 10000), // programada en el pasado
      },
    });

    // 2. Ejecutar el worker (con env.EMAIL_ENABLED=false por defecto)
    expect(env.EMAIL_ENABLED).toBe(false);
    await procesarEntregasPendientes();

    // 3. Verificar que la entrega permanece intacta en PENDIENTE con 0 intentos
    const entregaDespues = await prisma.entregaNotificacion.findUniqueOrThrow({
      where: { id: entrega.id },
    });

    expect(entregaDespues.estado).toBe(EstadoEntregaNotificacion.PENDIENTE);
    expect(entregaDespues.intentos).toBe(0);
    expect(entregaDespues.ultimoError).toBeNull();

    // Limpieza
    await prisma.entregaNotificacion.delete({ where: { id: entrega.id } });
    await prisma.notificacion.delete({ where: { id: notif.id } });
    await prisma.usuario.delete({ where: { id: usuario.id } });
  });

  it('construirMensajeMime genera un buffer MIME RFC 2822 válido con HTML, texto y adjunto CID', async () => {
    const mimeBuffer = await construirMensajeMime({
      from: 'Encuestas 5S <notificaciones@empresa.com>',
      to: 'auditor@empresa.com',
      subject: 'Auditorías asignadas — Septiembre 2026',
      text: 'Hola Andrea, estas son tus auditorías.',
      html: '<h1>Hola Andrea</h1><p>Estas son tus auditorías.</p><img src="cid:qr-code" />',
      attachments: [
        {
          filename: 'qr-code.png',
          content: Buffer.from('fake-png-content'),
          cid: 'qr-code',
          contentType: 'image/png',
          contentDisposition: 'inline',
        },
      ],
    });

    expect(Buffer.isBuffer(mimeBuffer)).toBe(true);
    const mimeString = mimeBuffer.toString('utf8');

    expect(mimeString).toContain('From: Encuestas 5S <notificaciones@empresa.com>');
    expect(mimeString).toContain('To: auditor@empresa.com');
    expect(mimeString).toContain('Subject:');
    expect(mimeString).toContain('multipart/alternative');
    expect(mimeString).toContain('Content-ID: <qr-code>');
    expect(mimeString).toContain('image/png');
  });
});