import nodemailer from 'nodemailer';
import { env } from './env';

export const transportCorreo = env.SMTP_ENABLED
  ? nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    auth: {
      user: env.SMTP_USER,
      pass: env.SMTP_PASS,
    },
  })
  : null;
