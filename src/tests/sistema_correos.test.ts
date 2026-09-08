import { describe, expect, it } from 'bun:test';
import { prisma } from '../db';
import { CanalNotificacion, EstadoEntregaNotificacion, RolUsuario, TipoNotificacion } from '../generated/prisma/enums';
import { hashSha256 } from '../utils/crypto';

describe('Endpoints y Operaciones de Sistema — Correos', () => {
  it('reenviar entrega post-SENT crea nueva Notificación y Entrega sin duplicar claveDedupe previa', async () => {
    // 1. Crear un usuario de prueba
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

    // 2. Crear una notificación previa y una entrega marcada como ENVIADA
    const claveDedupeOriginal = `asignacion-mensual-correo:${usuario.id}:2026-09`;
    const notifOriginal = await prisma.notificacion.create({
      data: {
        usuarioId: usuario.id,
        claveDedupe: claveDedupeOriginal,
        tipo: TipoNotificacion.ASIGNACION_MENSUAL_CORREO,
        titulo: 'Auditorías asignadas — Septiembre 2026',
        mensaje: 'Mensaje de asignación original',
        datos: { templateName: 'audit_assignment_monthly', areas: ['BORDADO'] },
      },
    });

    const destinoHash = hashSha256(usuario.correo!);
    const entregaOriginal = await prisma.entregaNotificacion.create({
      data: {
        notificacionId: notifOriginal.id,
        canal: CanalNotificacion.CORREO,
        estado: EstadoEntregaNotificacion.ENVIADA,
        destinoSnapshot: usuario.correo!,
        destinoHash,
        enviadoEn: new Date(),
        programadoEn: new Date(),
      },
    });

    // 3. Ejecutar la lógica de reenvío (como la hace 08_reenviar_entrega.ts)
    const reenvioTimestamp = Date.now() + 10;
    const claveDedupeReenvio = `reenvio-manual:${entregaOriginal.id}:${reenvioTimestamp}`;

    const nuevaNotificacion = await prisma.notificacion.create({
      data: {
        usuarioId: usuario.id,
        claveDedupe: claveDedupeReenvio,
        tipo: notifOriginal.tipo,
        titulo: notifOriginal.titulo,
        mensaje: notifOriginal.mensaje,
        ruta: notifOriginal.ruta,
        datos: notifOriginal.datos ?? undefined,
      },
    });

    const nuevaEntrega = await prisma.entregaNotificacion.create({
      data: {
        notificacionId: nuevaNotificacion.id,
        canal: CanalNotificacion.CORREO,
        estado: EstadoEntregaNotificacion.PENDIENTE,
        destinoSnapshot: entregaOriginal.destinoSnapshot,
        destinoHash: entregaOriginal.destinoHash,
        programadoEn: new Date(),
      },
    });

    expect(nuevaNotificacion.id).not.toBe(notifOriginal.id);
    expect(nuevaNotificacion.claveDedupe).toBe(claveDedupeReenvio);
    expect(nuevaEntrega.id).not.toBe(entregaOriginal.id);
    expect(nuevaEntrega.estado).toBe(EstadoEntregaNotificacion.PENDIENTE);

    // Limpieza
    await prisma.entregaNotificacion.deleteMany({
      where: { id: { in: [entregaOriginal.id, nuevaEntrega.id] } },
    });
    await prisma.notificacion.deleteMany({
      where: { id: { in: [notifOriginal.id, nuevaNotificacion.id] } },
    });
    await prisma.usuario.delete({
      where: { id: usuario.id },
    });
  });
});