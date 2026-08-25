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
