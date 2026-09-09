import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { prisma } from '../db';
import {
  CanalNotificacion,
  EstadoEntregaNotificacion,
  RolUsuario,
  TipoNotificacion,
} from '../generated/prisma/enums';
import {
  actualizarEstadoControlOperativo,
} from '../modules/notificaciones/control-operativo';
import { procesarEntregasPendientes } from '../modules/notificaciones/worker';

describe('Prueba Canario de Cola de Entregas y Control Operativo (Worker Real)', () => {
  let superAdmin: { id: number; nombre: string; correo: string | null };

  beforeAll(async () => {
    superAdmin = await prisma.usuario.upsert({
      where: { nombreUsuario: 'test_superadmin' },
      update: { activo: true, rol: RolUsuario.SUPER_ADMIN, correo: 'superadmin.test@cuadra.com.mx' },
      create: {
        nombreUsuario: 'test_superadmin',
        nombre: 'Super Admin Test',
        correo: 'superadmin.test@cuadra.com.mx',
        hashContrasena: 'hash_test_canary',
        rol: RolUsuario.SUPER_ADMIN,
        activo: true,
      },
      select: { id: true, nombre: true, correo: true },
    });
  });

  afterAll(async () => {
    try {
      await prisma.usuario.deleteMany({
        where: { nombreUsuario: 'test_superadmin' },
      });
    } catch {
      // Ignorar si ya se eliminó
    }
  });

  it('1. Crea exactamente 1 entrega canario en estado PENDIENTE dirigida al SUPER_ADMIN', async () => {
    const timestamp = Date.now();
    const claveDedupe = `canary:queue-test:${superAdmin.id}:${timestamp}`;

    const resultado = await prisma.$transaction(async (tx) => {
      const notificacion = await tx.notificacion.create({
        data: {
          usuarioId: superAdmin.id,
          claveDedupe,
          tipo: TipoNotificacion.SISTEMA,
          titulo: '[Canario 5S] Prueba de Entrega en Cola',
          mensaje: `Prueba canario en cola generada para ${superAdmin.nombre}.`,
          ruta: '/sistema/entregas',
          datos: {
            esCanario: true,
            templateName: 'canary_test_queue',
            destinatarioCorreo: superAdmin.correo,
          },
        },
      });

      const entrega = await tx.entregaNotificacion.create({
        data: {
          notificacionId: notificacion.id,
          canal: CanalNotificacion.CORREO,
          estado: EstadoEntregaNotificacion.PENDIENTE,
          destinoSnapshot: superAdmin.correo,
          programadoEn: new Date(),
          intentos: 0,
        },
      });

      return { notificacion, entrega };
    });

    expect(resultado.entrega.id).toBeGreaterThan(0);
    expect(resultado.entrega.estado).toBe(EstadoEntregaNotificacion.PENDIENTE);
    expect(resultado.entrega.intentos).toBe(0);
    expect(resultado.entrega.canal).toBe(CanalNotificacion.CORREO);
    expect(resultado.entrega.destinoSnapshot).toBe(superAdmin.correo);

    // Limpieza de prueba
    await prisma.entregaNotificacion.delete({ where: { id: resultado.entrega.id } });
    await prisma.notificacion.delete({ where: { id: resultado.notificacion.id } });
  });

  it('2. Mientras el Control Operativo esté PAUSADO, el worker NO procesa la entrega canario', async () => {
    // Asegurar que el control operativo esté en PAUSADO
    await actualizarEstadoControlOperativo('PAUSADO', 1, 'Test pausa control');


    const timestamp = Date.now();
    const claveDedupe = `canary:queue-test:${superAdmin.id}:${timestamp}`;

    const notificacion = await prisma.notificacion.create({
      data: {
        usuarioId: superAdmin.id,
        claveDedupe,
        tipo: TipoNotificacion.SISTEMA,
        titulo: '[Canario 5S] Prueba en Pausa',
        mensaje: 'Prueba que no debe salir mientras esté pausado.',
        datos: { esCanario: true },
      },
    });

    const entrega = await prisma.entregaNotificacion.create({
      data: {
        notificacionId: notificacion.id,
        canal: CanalNotificacion.CORREO,
        estado: EstadoEntregaNotificacion.PENDIENTE,
        destinoSnapshot: superAdmin.correo,
        programadoEn: new Date(Date.now() - 1000), // Ya vencida/lista
        intentos: 0,
      },
    });

    // Ejecutar ciclo del worker
    await procesarEntregasPendientes();

    // Verificar que la entrega permanece intacta en PENDIENTE con 0 intentos
    const entregaDespues = await prisma.entregaNotificacion.findUniqueOrThrow({
      where: { id: entrega.id },
    });

    expect(entregaDespues.estado).toBe(EstadoEntregaNotificacion.PENDIENTE);
    expect(entregaDespues.intentos).toBe(0);
    expect(entregaDespues.enviadoEn).toBeNull();
    expect(entregaDespues.bloqueadoPor).toBeNull();

    // Limpieza
    await prisma.entregaNotificacion.delete({ where: { id: entrega.id } });
    await prisma.notificacion.delete({ where: { id: notificacion.id } });
  });
});
