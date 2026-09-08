import nodemailer from 'nodemailer';
import type { EmailAttachment } from './email-smtp';

const mimeTransport = nodemailer.createTransport({
  streamTransport: true,
  buffer: true,
  newline: 'windows',
});

/**
 * Construye el mensaje RFC 2822 / MIME completo utilizando el generador streamTransport oficial de Nodemailer.
 * Genera el formato multipart/alternative con text/plain, text/html y adjuntos inline CID para códigos QR.
 */
export const construirMensajeMime = async (input: {
  from?: string;
  to: string;
  subject: string;
  text: string;
  html?: string;
  attachments?: EmailAttachment[];
}): Promise<Buffer> => {
  const info = await mimeTransport.sendMail({
    from: input.from,
    to: input.to,
    subject: input.subject,
    text: input.text,
    html: input.html,
    attachments: input.attachments,
  });

  return info.message as Buffer;
};