import { randomUUID } from 'node:crypto';
import { env } from '../../config/env';
import { webPush } from '../../config/push';
import { prisma } from '../../db';
import { CanalNotificacion, EstadoEntregaNotificacion } from '../../generated/prisma/enums';
import { calcularProximoIntento } from './helper';
import { generarQrBuffer } from './qr';
import { resolverTemplate } from './templates';
import type { EmailAttachment } from './proveedores/email';
import { enviarCorreo } from './proveedores/email';
import { enviarWhatsapp } from './proveedores/whatsapp';

const workerId = `worker-${process.pid}-${randomUUID()}`;

export const procesarEntregasPendientes = async () => {
  const ahora = new Date();

  // Filtrar canales activos según configuración. Si EMAIL_ENABLED=false, las entregas
  // por canal CORREO permanecen en PENDIENTE sin ser reclamadas ni fallar.
  const canalesPermitidos: CanalNotificacion[] = [CanalNotificacion.PUSH, CanalNotificacion.WHATSAPP];
  if (env.EMAIL_ENABLED) {
    canalesPermitidos.push(CanalNotificacion.CORREO);
  }

  const candidatos = await prisma.entregaNotificacion.findMany({
    where: {
      canal: { in: canalesPermitidos },
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
        canal: { in: canalesPermitidos },
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
      await webPush.sendNotification(
        {
          endpoint: entrega.suscripcionPush.endpoint,
          keys: { p256dh: entrega.suscripcionPush.p256dh, auth: entrega.suscripcionPush.auth },
        },
        JSON.stringify({
          titulo: entrega.notificacion.titulo,
          mensaje: entrega.notificacion.mensaje,
          ruta: entrega.notificacion.ruta,
        })
      );
    } else if (entrega.canal === CanalNotificacion.CORREO) {
      if (!entrega.destinoSnapshot || entrega.destinoSnapshot === 'sin-correo') {
        const err = new Error('Destino de correo no informado');
        (err as unknown as { permanente: boolean }).permanente = true;
        throw err;
      }

      const templateResult = resolverTemplate(entrega.notificacion.datos, {
        titulo: entrega.notificacion.titulo,
        mensaje: entrega.notificacion.mensaje,
        ruta: entrega.notificacion.ruta,
      });

      const attachments: EmailAttachment[] = [];
      if (templateResult?.qrUrl) {
        try {
          const qrBuffer = await generarQrBuffer(templateResult.qrUrl);
          attachments.push({
            filename: 'qr-code.png',
            content: qrBuffer,
            cid: 'qr-code',
            contentType: 'image/png',
            contentDisposition: 'inline',
          });
        } catch {
          // Si falla la generación del QR, continuar con el correo sin bloquear
        }
      }

      const resEnvio = await enviarCorreo({
        to: entrega.destinoSnapshot,
        subject: templateResult?.subject ?? entrega.notificacion.titulo,
        text: templateResult?.text ?? entrega.notificacion.mensaje,
        html: templateResult?.html,
        attachments: attachments.length > 0 ? attachments : undefined,
      });

      if (!resEnvio.enviado) {
        const error = new Error(resEnvio.error ?? 'Fallo al enviar correo');
        (error as unknown as { permanente?: boolean; retryAfterSeconds?: number }).permanente = resEnvio.permanente;
        (error as unknown as { permanente?: boolean; retryAfterSeconds?: number }).retryAfterSeconds = resEnvio.retryAfterSeconds;
        throw error;
      }
    } else if (entrega.canal === CanalNotificacion.WHATSAPP) {
      if (!entrega.destinoSnapshot) throw new Error('Destino WhatsApp no informado');
      const resultado = await enviarWhatsapp(entrega.destinoSnapshot, entrega.notificacion.mensaje);
      if (!resultado.enviado) throw new Error(resultado.error);
    }

    await prisma.entregaNotificacion.update({
      where: { id },
      data: {
        estado: EstadoEntregaNotificacion.ENVIADA,
        enviadoEn: new Date(),
        ultimoIntentoEn: new Date(),
        bloqueadoHasta: null,
        bloqueadoPor: null,
        ultimoError: null,
      },
    });
  } catch (error) {
    const errObj = error as { permanente?: boolean; message?: string; retryAfterSeconds?: number };
    const esPermanente = errObj?.permanente === true;
    const intentos = entrega.intentos + 1;
    const maxAlcanzado = intentos >= 5;

    let proximoIntentoEn: Date | null = null;
    if (!esPermanente && !maxAlcanzado) {
      if (typeof errObj?.retryAfterSeconds === 'number' && errObj.retryAfterSeconds > 0) {
        proximoIntentoEn = new Date(Date.now() + errObj.retryAfterSeconds * 1000);
      } else {
        proximoIntentoEn = calcularProximoIntento(intentos);
      }
    }

    await prisma.entregaNotificacion.update({
      where: { id },
      data: {
        estado: EstadoEntregaNotificacion.FALLIDA,
        intentos,
        ultimoIntentoEn: new Date(),
        proximoIntentoEn,
        ultimoError: error instanceof Error ? error.message.slice(0, 1000) : 'Error desconocido',
        bloqueadoHasta: null,
        bloqueadoPor: null,
      },
    });
  }
};