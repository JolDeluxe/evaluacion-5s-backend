/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from 'bun:test';
import nodemailer from 'nodemailer';
import { env } from '../config/env';

describe('SMTP Transporter - Pool & Rate Limiting', () => {
  it('las opciones por defecto de SMTP Pool en env.ts contienen maxConnections=1, rateLimit=1 y rateDelta=3000ms', () => {
    expect(env.SMTP_POOL_ENABLED).toBe(true);
    expect(env.SMTP_MAX_CONNECTIONS).toBe(1);
    expect(env.SMTP_RATE_LIMIT).toBe(1);
    expect(env.SMTP_RATE_DELTA_MS).toBe(3000);
  });

  it('un transporte SMTP creado con pool=true y rateLimit=1 configura la cola SMTPPool de Nodemailer', () => {
    const transporter = nodemailer.createTransport({
      pool: true,
      maxConnections: 1,
      rateLimit: 1,
      rateDelta: 3000,
      host: 'smtp.office365.com',
      port: 587,
      auth: { user: 'test@example.com', pass: 'secret' },
    });

    // Nodemailer asigna el transporter options internamente
    const options = (transporter as any).options;
    expect(options.pool).toBe(true);
    expect(options.maxConnections).toBe(1);
    expect(options.rateLimit).toBe(1);
    expect(options.rateDelta).toBe(3000);
  });
});
