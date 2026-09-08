import type { AsignacionAuditoria, ObjetivoAuditoria, Usuario } from '../../generated/prisma/client';
import { CanalNotificacion, TipoNotificacion } from '../../generated/prisma/enums';
import { hashSha256 } from '../../utils/crypto';
import type { PrismaTransaction } from '../../db';

export const crearNotificacionAsignacion = async (
  asignacion: AsignacionAuditoria & { objetivoAuditoria: ObjetivoAuditoria; auditor: Usuario },
  tx: PrismaTransaction
) => {
  const claveDedupe = `asignacion:${asignacion.id}:nueva`;
  const notificacion = await tx.notificacion.upsert({
    where: { claveDedupe },
    update: {},
    create: {
      usuarioId: asignacion.auditorId,
      claveDedupe,
      tipo: TipoNotificacion.NUEVA_ASIGNACION,
      titulo: 'Nueva auditoria asignada',
      mensaje: `Area: ${asignacion.objetivoAuditoria.nombreAreaSnapshot}`,
      ruta: `/auditorias/asignaciones/${asignacion.id}`,
    },
  });

  const suscripciones = await tx.suscripcionPush.findMany({
    where: { usuarioId: asignacion.auditorId, revocadoEn: null },
  });
  for (const suscripcion of suscripciones) {
    await tx.entregaNotificacion.upsert({
      where: {
        notificacionId_canal_destinoHash: {
          notificacionId: notificacion.id,
          canal: CanalNotificacion.PUSH,
          destinoHash: suscripcion.hashEndpoint,
        },
      },
      update: {},
      create: {
        notificacionId: notificacion.id,
        suscripcionPushId: suscripcion.id,
        canal: CanalNotificacion.PUSH,
        destinoSnapshot: suscripcion.hashEndpoint,
        destinoHash: suscripcion.hashEndpoint,
        programadoEn: new Date(),
      },
    });
  }

  if (asignacion.auditor.correo) {
    const destinoHash = hashSha256(asignacion.auditor.correo);
    await tx.entregaNotificacion.upsert({
      where: { notificacionId_canal_destinoHash: { notificacionId: notificacion.id, canal: CanalNotificacion.CORREO, destinoHash } },
      update: {},
      create: {
        notificacionId: notificacion.id,
        canal: CanalNotificacion.CORREO,
        destinoSnapshot: asignacion.auditor.correo,
        destinoHash,
        programadoEn: new Date(),
      },
    });
  }
};

export const crearNotificacionUsuario = async (
  tx: PrismaTransaction,
  data: {
    usuario: Pick<Usuario, 'id' | 'correo'>;
    claveDedupe: string;
    tipo: TipoNotificacion;
    titulo: string;
    mensaje: string;
    ruta?: string | null;
  }
) => {
  const notificacion = await tx.notificacion.upsert({
    where: { claveDedupe: data.claveDedupe },
    update: {},
    create: {
      usuarioId: data.usuario.id,
      claveDedupe: data.claveDedupe,
      tipo: data.tipo,
      titulo: data.titulo,
      mensaje: data.mensaje,
      ruta: data.ruta ?? null,
    },
  });

  const suscripciones = await tx.suscripcionPush.findMany({
    where: { usuarioId: data.usuario.id, revocadoEn: null },
  });
  for (const suscripcion of suscripciones) {
    await tx.entregaNotificacion.upsert({
      where: {
        notificacionId_canal_destinoHash: {
          notificacionId: notificacion.id,
          canal: CanalNotificacion.PUSH,
          destinoHash: suscripcion.hashEndpoint,
        },
      },
      update: {},
      create: {
        notificacionId: notificacion.id,
        suscripcionPushId: suscripcion.id,
        canal: CanalNotificacion.PUSH,
        destinoSnapshot: suscripcion.hashEndpoint,
        destinoHash: suscripcion.hashEndpoint,
        programadoEn: new Date(),
      },
    });
  }

  if (data.usuario.correo) {
    const destinoHash = hashSha256(data.usuario.correo);
    await tx.entregaNotificacion.upsert({
      where: { notificacionId_canal_destinoHash: { notificacionId: notificacion.id, canal: CanalNotificacion.CORREO, destinoHash } },
      update: {},
      create: {
        notificacionId: notificacion.id,
        canal: CanalNotificacion.CORREO,
        destinoSnapshot: data.usuario.correo,
        destinoHash,
        programadoEn: new Date(),
      },
    });
  }

  return notificacion;
};

export const calcularProximoIntento = (intentos: number) => {
  const minutos = [1, 5, 15, 60, 360][Math.min(intentos, 4)];
  return new Date(Date.now() + minutos * 60 * 1000);
};

export type NodemailerErrorLike = Error & {
  code?: string;
  responseCode?: number;
  command?: string;
};

/**
 * Determina si un error retornado por el proveedor SMTP es permanente o transitorio.
 * Utiliza propiedades estructuradas de Nodemailer/Node (responseCode 5xx, code EENVELOPE, etc.)
 */
export const esErrorPermanenteSmtp = (error: unknown): boolean => {
  if (!error) return false;

  const err = error as NodemailerErrorLike;

  // 1. Códigos de respuesta SMTP 5xx (550-559 = mailbox unavailable, user unknown, etc.)
  if (typeof err.responseCode === 'number') {
    if (err.responseCode >= 550 && err.responseCode < 600) {
      return true;
    }
  }

  // 2. Códigos estructurados de Nodemailer / Node
  if (typeof err.code === 'string') {
    const codigosPermanentes = [
      'EENVELOPE', // Destinatario o remitente rechazado a nivel de sobre
      'EMESSAGE', // Mensaje rechazado permanentemente por política o formato
      'EADDRNOTAVAIL',
    ];
    if (codigosPermanentes.includes(err.code)) {
      return true;
    }
  }

  // 3. Fallback defensivo sobre mensaje
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    if (
      msg.includes('user not found') ||
      msg.includes('no such user') ||
      msg.includes('mailbox unavailable') ||
      msg.includes('recipient address rejected')
    ) {
      return true;
    }
  }

  return false;
};

