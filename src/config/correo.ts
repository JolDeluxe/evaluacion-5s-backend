import nodemailer from 'nodemailer';
import type SMTPPool from 'nodemailer/lib/smtp-pool';
import { env } from './env';

/**
 * Instancia única y compartida del transporte SMTP de Nodemailer.
 * Utiliza SMTP Pool y Rate Limiting a nivel de proveedor (sin recrear conexiones por mensaje).
 */
export const transportCorreo = env.SMTP_ENABLED
  ? nodemailer.createTransport({
      pool: env.SMTP_POOL_ENABLED,
      maxConnections: env.SMTP_MAX_CONNECTIONS,
      maxMessages: Infinity,
      rateLimit: env.SMTP_RATE_LIMIT,
      rateDelta: env.SMTP_RATE_DELTA_MS,
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      requireTLS: true,
      auth: {
        user: env.SMTP_USER,
        pass: env.SMTP_PASS,
      },
    } as SMTPPool.Options)
  : null;
