import type { Request, Response } from 'express';
import { env } from '../../config/env';
import { responder } from '../../utils/respuesta';
import { obtenerEstadoConexionMicrosoft } from '../notificaciones/proveedores/microsoft-graph';

export const estadoCorreosSistema = async (_req: Request, res: Response) => {
  const timeZone = process.env.TZ || 'America/Mexico_City';
  const microsoftEstado = await obtenerEstadoConexionMicrosoft();

  responder(res, {
    estado: {
      emailEnabled: env.EMAIL_ENABLED,
      emailTestEnabled: env.EMAIL_TEST_ENABLED,
      emailProvider: env.EMAIL_PROVIDER,
      microsoft: {
        configurado: microsoftEstado.configurado,
        conectado: microsoftEstado.conectado,
        cuenta: microsoftEstado.cuenta,
        nombre: microsoftEstado.nombre,
        requiereReconexion: microsoftEstado.requiereReconexion,
        conectadoEn: microsoftEstado.conectadoEn,
        authority: env.MICROSOFT_GRAPH_AUTHORITY,
        remitenteConfigurado: env.MICROSOFT_GRAPH_SENDER_EMAIL ?? null,
      },
      smtp: {
        habilitado: env.SMTP_ENABLED,
        host: env.SMTP_HOST ?? null,
        port: env.SMTP_PORT,
        secure: env.SMTP_SECURE,
        remitente: env.SMTP_FROM ?? null,
        autenticado: Boolean(env.SMTP_USER && env.SMTP_PASS),
      },
      worker: {
        habilitado: env.NOTIFICACIONES_WORKER_ENABLED,
        cron: env.NOTIFICACIONES_WORKER_CRON,
      },
      appPublicUrl: env.APP_PUBLIC_URL,
      timeZone,
      servidorFechaActual: new Date().toISOString(),
    },
  });
};