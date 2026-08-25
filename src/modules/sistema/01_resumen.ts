import type { Request, Response } from 'express';
import { prisma } from '../../db';
import { env } from '../../config/env';
import { responder } from '../../utils/respuesta';

export const resumenSistema = async (_req: Request, res: Response) => {
  const inicio = Date.now();
  await prisma.$queryRaw`SELECT 1`;

  const [usuariosActivos, sesionesActivas, entregasPendientes, entregasFallidas] = await prisma.$transaction([
    prisma.usuario.count({ where: { activo: true } }),
    prisma.sesion.count({ where: { revocadoEn: null, expiraEn: { gt: new Date() } } }),
    prisma.entregaNotificacion.count({ where: { estado: 'PENDIENTE' } }),
    prisma.entregaNotificacion.count({ where: { estado: 'FALLIDA' } }),
  ]);

  responder(res, {
    sistema: {
      api: 'ok',
      mysql: 'ok',
      latenciaDbMs: Date.now() - inicio,
      entorno: env.NODE_ENV,
      uptimeSegundos: Math.round(process.uptime()),
      runtime: {
        nombre: 'bun',
        version: Bun.version,
      },
      servicios: {
        cloudinary: env.CLOUDINARY_ENABLED,
        smtp: env.SMTP_ENABLED,
        push: env.VAPID_ENABLED,
        whatsapp: env.WHATSAPP_ENABLED,
        codigoVerificacionArea: true,
      },
      workers: {
        notificaciones: env.NOTIFICACIONES_WORKER_ENABLED,
        cronNotificaciones: env.NOTIFICACIONES_WORKER_CRON,
      },
      conteos: {
        usuariosActivos,
        sesionesActivas,
        entregasPendientes,
        entregasFallidas,
      },
    },
  });
};
