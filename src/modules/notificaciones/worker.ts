import { randomUUID } from 'node:crypto';
import { env } from '../../config/env';
import { transportCorreo } from '../../config/correo';
import { webPush } from '../../config/push';
import { prisma } from '../../db';
import { CanalNotificacion, EstadoEntregaNotificacion } from '../../generated/prisma/enums';
import { calcularProximoIntento } from './helper';
import { enviarWhatsapp } from './proveedores/whatsapp';

const workerId = `worker-${process.pid}-${randomUUID()}`;

export const procesarEntregasPendientes = async () => {
  const ahora = new Date();
  const candidatos = await prisma.entregaNotificacion.findMany({
    where: {
      OR: [
        { estado: EstadoEntregaNotificacion.PENDIENTE, programadoEn: { lte: ahora } },
        { estado: EstadoEntregaNotificacion.FALLIDA, proximoIntentoEn: { lte: ahora }, intentos: { lt: 5 } },
        { estado: EstadoEntregaNotificacion.PROCESANDO, bloqueadoHasta: { lt: ahora } },
      ],
    },
    take: 25,
    orderBy: { programadoEn: 'asc' },
  });

  for (const candidato of candidatos) {
    const reclamado = await prisma.entregaNotificacion.updateMany({
      where: {
        id: candidato.id,
        OR: [
          { estado: EstadoEntregaNotificacion.PENDIENTE },
          { estado: EstadoEntregaNotificacion.FALLIDA, proximoIntentoEn: { lte: ahora } },
          { estado: EstadoEntregaNotificacion.PROCESANDO, bloqueadoHasta: { lt: ahora } },
        ],
      },
      data: {
        estado: EstadoEntregaNotificacion.PROCESANDO,
        bloqueadoHasta: new Date(Date.now() + 2 * 60 * 1000),
        bloqueadoPor: workerId,
      },
    });
    if (reclamado.count !== 1) continue;

    await procesarEntrega(candidato.id);
  }
};

const procesarEntrega = async (id: number) => {
  const entrega = await prisma.entregaNotificacion.findUniqueOrThrow({
    where: { id },
    include: { notificacion: true, suscripcionPush: true },
  });
  try {
    if (entrega.canal === CanalNotificacion.PUSH) {
      if (!env.VAPID_ENABLED || !entrega.suscripcionPush) throw new Error('Push no configurado');
      await webPush.sendNotification({
        endpoint: entrega.suscripcionPush.endpoint,
        keys: { p256dh: entrega.suscripcionPush.p256dh, auth: entrega.suscripcionPush.auth },
      }, JSON.stringify({ titulo: entrega.notificacion.titulo, mensaje: entrega.notificacion.mensaje, ruta: entrega.notificacion.ruta }));
    } else if (entrega.canal === CanalNotificacion.CORREO) {
      if (!env.SMTP_ENABLED || !transportCorreo || !entrega.destinoSnapshot) throw new Error('Correo no configurado');
      await transportCorreo.sendMail({
        to: entrega.destinoSnapshot,
        from: env.SMTP_FROM,
        subject: entrega.notificacion.titulo,
        text: entrega.notificacion.mensaje,
      });
    } else if (entrega.canal === CanalNotificacion.WHATSAPP) {
      if (!entrega.destinoSnapshot) throw new Error('Destino WhatsApp no informado');
      const resultado = await enviarWhatsapp(entrega.destinoSnapshot, entrega.notificacion.mensaje);
      if (!resultado.enviado) throw new Error(resultado.error);
    }
    await prisma.entregaNotificacion.update({ where: { id }, data: { estado: EstadoEntregaNotificacion.ENVIADA, enviadoEn: new Date(), ultimoIntentoEn: new Date(), bloqueadoHasta: null, bloqueadoPor: null } });
  } catch (error) {
    const intentos = entrega.intentos + 1;
    await prisma.entregaNotificacion.update({
      where: { id },
      data: {
        estado: EstadoEntregaNotificacion.FALLIDA,
        intentos,
        ultimoIntentoEn: new Date(),
        proximoIntentoEn: intentos >= 5 ? null : calcularProximoIntento(intentos),
        ultimoError: error instanceof Error ? error.message.slice(0, 1000) : 'Error desconocido',
        bloqueadoHasta: null,
        bloqueadoPor: null,
      },
    });
  }
};
