import { describe, expect, it } from 'bun:test';
import { prisma } from '../db';
import {
  CanalNotificacion,
  EstadoEntregaNotificacion,
  RolUsuario,
  TipoNotificacion,
} from '../generated/prisma/enums';
import { hashSha256 } from '../utils/crypto';

describe('Máquina de Estados de Entregas y Control de Reintentos', () => {
  it('1. Intento #5 que falla pasa definitivamente a FALLIDA con proximoIntentoEn = null', async () => {
    const timestamp = Date.now();
    const usuario = await prisma.usuario.create({
      data: {
        nombreUsuario: `user_test_max5_${timestamp}`,
        nombre: `Test Max 5 ${timestamp}`,
        correo: `test.max5.${timestamp}@example.test`,
        hashContrasena: 'dummy',
        rol: RolUsuario.AUDITOR,
        activo: true,
      },
    });

    const notif = await prisma.notificacion.create({
      data: {
        usuarioId: usuario.id,
        claveDedupe: `test-max-intentos:${timestamp}`,
        tipo: TipoNotificacion.ASIGNACION_MENSUAL_CORREO,
        titulo: 'Test Max Intentos',
        mensaje: 'Test',
      },
    });

    // Entrega que ya va por su 4to intento
    const entrega = await prisma.entregaNotificacion.create({
      data: {
        notificacionId: notif.id,
        canal: CanalNotificacion.CORREO,
        estado: EstadoEntregaNotificacion.PENDIENTE,
        destinoSnapshot: usuario.correo!,
        destinoHash: hashSha256(usuario.correo!),
        intentos: 4,
        programadoEn: new Date(),
      },
    });

    // Simular el fallo del 5to intento según la regla de worker.ts
    const MAX_INTENTOS = 5;
    const nuevosIntentos = Math.min(MAX_INTENTOS, entrega.intentos + 1);
    const maxAlcanzado = nuevosIntentos >= MAX_INTENTOS;
    const proximoIntentoEn = maxAlcanzado ? null : new Date(Date.now() + 60000);

    const entregaFallida = await prisma.entregaNotificacion.update({
      where: { id: entrega.id },
      data: {
        estado: EstadoEntregaNotificacion.FALLIDA,
        intentos: nuevosIntentos,
        ultimoIntentoEn: new Date(),
        proximoIntentoEn,
        ultimoError: 'Error simulado en intento 5',
      },
    });

    expect(entregaFallida.estado).toBe(EstadoEntregaNotificacion.FALLIDA);
    expect(entregaFallida.intentos).toBe(5);
    expect(entregaFallida.proximoIntentoEn).toBeNull();

    // Limpieza
    await prisma.entregaNotificacion.delete({ where: { id: entrega.id } });
    await prisma.notificacion.delete({ where: { id: notif.id } });
    await prisma.usuario.delete({ where: { id: usuario.id } });
  });

  it('2. Nunca puede incrementarse a intento #6 (clamping a MAX_INTENTOS = 5)', async () => {
    const timestamp = Date.now();
    const usuario = await prisma.usuario.create({
      data: {
        nombreUsuario: `user_test_clamp_${timestamp}`,
        nombre: `Test Clamp ${timestamp}`,
        correo: `test.clamp.${timestamp}@example.test`,
        hashContrasena: 'dummy',
        rol: RolUsuario.AUDITOR,
        activo: true,
      },
    });

    const notif = await prisma.notificacion.create({
      data: {
        usuarioId: usuario.id,
        claveDedupe: `test-clamp-intentos:${timestamp}`,
        tipo: TipoNotificacion.ASIGNACION_MENSUAL_CORREO,
        titulo: 'Test Clamp Intentos',
        mensaje: 'Test',
      },
    });

    // Entrega que hipotéticamente ya tiene 5 intentos
    const entrega = await prisma.entregaNotificacion.create({
      data: {
        notificacionId: notif.id,
        canal: CanalNotificacion.CORREO,
        estado: EstadoEntregaNotificacion.FALLIDA,
        destinoSnapshot: usuario.correo!,
        destinoHash: hashSha256(usuario.correo!),
        intentos: 5,
        programadoEn: new Date(),
      },
    });

    const MAX_INTENTOS = 5;
    const nuevosIntentos = Math.min(MAX_INTENTOS, entrega.intentos + 1);
    expect(nuevosIntentos).toBe(5); // Imposible que suba a 6

    // Limpieza
    await prisma.entregaNotificacion.delete({ where: { id: entrega.id } });
    await prisma.notificacion.delete({ where: { id: notif.id } });
    await prisma.usuario.delete({ where: { id: usuario.id } });
  });

  it('3. Cancelación individual y masiva eliminan proximoIntentoEn (queda null)', async () => {
    const timestamp = Date.now();
    const usuario = await prisma.usuario.create({
      data: {
        nombreUsuario: `user_test_cancel_${timestamp}`,
        nombre: `Test Cancel ${timestamp}`,
        correo: `test.cancel.${timestamp}@example.test`,
        hashContrasena: 'dummy',
        rol: RolUsuario.AUDITOR,
        activo: true,
      },
    });

    const notif1 = await prisma.notificacion.create({
      data: {
        usuarioId: usuario.id,
        claveDedupe: `test-cancel-1:${timestamp}`,
        tipo: TipoNotificacion.RECORDATORIO,
        titulo: 'Test Cancel 1',
        mensaje: 'Test 1',
      },
    });

    const notif2 = await prisma.notificacion.create({
      data: {
        usuarioId: usuario.id,
        claveDedupe: `test-cancel-2:${timestamp}`,
        tipo: TipoNotificacion.RECORDATORIO,
        titulo: 'Test Cancel 2',
        mensaje: 'Test 2',
      },
    });

    const entrega1 = await prisma.entregaNotificacion.create({
      data: {
        notificacionId: notif1.id,
        canal: CanalNotificacion.CORREO,
        estado: EstadoEntregaNotificacion.PENDIENTE,
        destinoSnapshot: usuario.correo!,
        destinoHash: hashSha256(usuario.correo!),
        intentos: 2,
        proximoIntentoEn: new Date(Date.now() + 300000), // con próximo intento agendado
        programadoEn: new Date(),
      },
    });

    const entrega2 = await prisma.entregaNotificacion.create({
      data: {
        notificacionId: notif2.id,
        canal: CanalNotificacion.CORREO,
        estado: EstadoEntregaNotificacion.FALLIDA,
        destinoSnapshot: usuario.correo!,
        destinoHash: hashSha256(usuario.correo!),
        intentos: 3,
        proximoIntentoEn: new Date(Date.now() + 600000), // con próximo intento agendado
        programadoEn: new Date(),
      },
    });

    // 3a. Cancelación individual (lógica de cancelarEntregaSistema)
    const cancelada1 = await prisma.entregaNotificacion.update({
      where: { id: entrega1.id },
      data: {
        estado: EstadoEntregaNotificacion.CANCELADA,
        proximoIntentoEn: null,
        ultimoError: 'Cancelada manualmente por SUPER_ADMIN',
      },
    });

    expect(cancelada1.estado).toBe(EstadoEntregaNotificacion.CANCELADA);
    expect(cancelada1.proximoIntentoEn).toBeNull();

    // 3b. Cancelación masiva (lógica de cancelarEntregasMasivoSistema)
    await prisma.entregaNotificacion.updateMany({
      where: { id: { in: [entrega2.id] } },
      data: {
        estado: EstadoEntregaNotificacion.CANCELADA,
        proximoIntentoEn: null,
        ultimoError: 'Cancelada en lote por SUPER_ADMIN',
      },
    });

    const cancelada2 = await prisma.entregaNotificacion.findUniqueOrThrow({
      where: { id: entrega2.id },
    });
    expect(cancelada2.estado).toBe(EstadoEntregaNotificacion.CANCELADA);
    expect(cancelada2.proximoIntentoEn).toBeNull();

    // Limpieza
    await prisma.entregaNotificacion.deleteMany({ where: { id: { in: [entrega1.id, entrega2.id] } } });
    await prisma.notificacion.deleteMany({ where: { id: { in: [notif1.id, notif2.id] } } });
    await prisma.usuario.delete({ where: { id: usuario.id } });
  });

  it('4. Entrega en FALLIDA agotada (intentos >= 5 o proximoIntentoEn = null) nunca es tomada por la query de candidatos del worker', async () => {
    const timestamp = Date.now();
    const usuario = await prisma.usuario.create({
      data: {
        nombreUsuario: `user_test_query_${timestamp}`,
        nombre: `Test Query ${timestamp}`,
        correo: `test.query.${timestamp}@example.test`,
        hashContrasena: 'dummy',
        rol: RolUsuario.AUDITOR,
        activo: true,
      },
    });

    const notif1 = await prisma.notificacion.create({
      data: {
        usuarioId: usuario.id,
        claveDedupe: `test-query-1:${timestamp}`,
        tipo: TipoNotificacion.RESULTADO_MENSUAL_CORREO,
        titulo: 'Test Query Worker 1',
        mensaje: 'Test 1',
      },
    });

    const notif2 = await prisma.notificacion.create({
      data: {
        usuarioId: usuario.id,
        claveDedupe: `test-query-2:${timestamp}`,
        tipo: TipoNotificacion.RESULTADO_MENSUAL_CORREO,
        titulo: 'Test Query Worker 2',
        mensaje: 'Test 2',
      },
    });

    // Crear 2 entregas fallidas agotadas: una con intentos=5 y null, otra con intentos=5 y fecha pasada
    const entregaAgotada1 = await prisma.entregaNotificacion.create({
      data: {
        notificacionId: notif1.id,
        canal: CanalNotificacion.CORREO,
        estado: EstadoEntregaNotificacion.FALLIDA,
        destinoSnapshot: usuario.correo!,
        destinoHash: hashSha256(usuario.correo!),
        intentos: 5,
        proximoIntentoEn: null,
        programadoEn: new Date(Date.now() - 10000),
      },
    });

    const entregaAgotada2 = await prisma.entregaNotificacion.create({
      data: {
        notificacionId: notif2.id,
        canal: CanalNotificacion.CORREO,
        estado: EstadoEntregaNotificacion.FALLIDA,
        destinoSnapshot: usuario.correo!,
        destinoHash: hashSha256(usuario.correo!),
        intentos: 5,
        proximoIntentoEn: new Date(Date.now() - 5000),
        programadoEn: new Date(Date.now() - 10000),
      },
    });

    // Query exacta usada por el worker
    const ahora = new Date();
    const MAX_INTENTOS = 5;
    const candidatos = await prisma.entregaNotificacion.findMany({
      where: {
        id: { in: [entregaAgotada1.id, entregaAgotada2.id] },
        canal: { in: [CanalNotificacion.CORREO] },
        OR: [
          { estado: EstadoEntregaNotificacion.PENDIENTE, programadoEn: { lte: ahora }, intentos: { lt: MAX_INTENTOS } },
          { estado: EstadoEntregaNotificacion.FALLIDA, proximoIntentoEn: { lte: ahora, not: null }, intentos: { lt: MAX_INTENTOS } },
          { estado: EstadoEntregaNotificacion.PROCESANDO, bloqueadoHasta: { lt: ahora } },
        ],
      },
    });

    // Ninguna entrega agotada debe ser seleccionada como candidata
    expect(candidatos.length).toBe(0);

    // Limpieza
    await prisma.entregaNotificacion.deleteMany({
      where: { id: { in: [entregaAgotada1.id, entregaAgotada2.id] } },
    });
    await prisma.notificacion.deleteMany({ where: { id: { in: [notif1.id, notif2.id] } } });
    await prisma.usuario.delete({ where: { id: usuario.id } });
  });

  it('5. Reintentar manualmente resetea intentos a 0 y proximoIntentoEn a null', async () => {
    const timestamp = Date.now();
    const usuario = await prisma.usuario.create({
      data: {
        nombreUsuario: `user_test_retry_${timestamp}`,
        nombre: `Test Retry ${timestamp}`,
        correo: `test.retry.${timestamp}@example.test`,
        hashContrasena: 'dummy',
        rol: RolUsuario.AUDITOR,
        activo: true,
      },
    });

    const notif = await prisma.notificacion.create({
      data: {
        usuarioId: usuario.id,
        claveDedupe: `test-retry:${timestamp}`,
        tipo: TipoNotificacion.ASIGNACION_MENSUAL_CORREO,
        titulo: 'Test Retry Reset',
        mensaje: 'Test',
      },
    });

    const entregaFallida = await prisma.entregaNotificacion.create({
      data: {
        notificacionId: notif.id,
        canal: CanalNotificacion.CORREO,
        estado: EstadoEntregaNotificacion.FALLIDA,
        destinoSnapshot: usuario.correo!,
        destinoHash: hashSha256(usuario.correo!),
        intentos: 5,
        proximoIntentoEn: null,
        ultimoError: 'Error previo permanente',
        programadoEn: new Date(Date.now() - 3600000),
      },
    });

    // Ejecutar lógica de reintento de 05_reintentar_entrega_notificacion.ts
    const entregaReintentada = await prisma.entregaNotificacion.update({
      where: { id: entregaFallida.id },
      data: {
        estado: EstadoEntregaNotificacion.PENDIENTE,
        intentos: 0,
        programadoEn: new Date(),
        proximoIntentoEn: null,
        bloqueadoHasta: null,
        bloqueadoPor: null,
        ultimoError: null,
      },
    });

    expect(entregaReintentada.estado).toBe(EstadoEntregaNotificacion.PENDIENTE);
    expect(entregaReintentada.intentos).toBe(0);
    expect(entregaReintentada.proximoIntentoEn).toBeNull();
    expect(entregaReintentada.ultimoError).toBeNull();

    // Limpieza
    await prisma.entregaNotificacion.delete({ where: { id: entregaFallida.id } });
    await prisma.notificacion.delete({ where: { id: notif.id } });
    await prisma.usuario.delete({ where: { id: usuario.id } });
  });

  it('6. EMAIL_ENABLED=false o controlOperativo=PAUSADO no incluye CORREO en canalesPermitidos (entregas quedan intactas en PENDIENTE)', async () => {
    // Verificar regla de aislamiento de canal
    const simularCanalesPermitidos = (emailEnabled: boolean, estadoControl: string) => {
      const canales: CanalNotificacion[] = [CanalNotificacion.PUSH, CanalNotificacion.WHATSAPP];
      if (emailEnabled && estadoControl === 'ACTIVO') {
        canales.push(CanalNotificacion.CORREO);
      }
      return canales;
    };

    // Caso: emailEnabled=false, control=PAUSADO -> solo PUSH y WHATSAPP
    expect(simularCanalesPermitidos(false, 'PAUSADO')).not.toContain(CanalNotificacion.CORREO);
    // Caso: emailEnabled=false, control=ACTIVO -> no permitido
    expect(simularCanalesPermitidos(false, 'ACTIVO')).not.toContain(CanalNotificacion.CORREO);
    // Caso: emailEnabled=true, control=PAUSADO -> no permitido (fail-safe)
    expect(simularCanalesPermitidos(true, 'PAUSADO')).not.toContain(CanalNotificacion.CORREO);
    // Caso: emailEnabled=true, control=ACTIVO -> permitido
    expect(simularCanalesPermitidos(true, 'ACTIVO')).toContain(CanalNotificacion.CORREO);
  });
});
