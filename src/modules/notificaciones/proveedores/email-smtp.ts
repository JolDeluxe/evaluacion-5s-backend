import { transportCorreo } from '../../../config/correo';
import { env } from '../../../config/env';
import { esErrorPermanenteSmtp } from '../helper';

export type EmailAttachment = {
  filename: string;
  content: Buffer | string;
  cid?: string;
  contentType?: string;
  contentDisposition?: 'inline' | 'attachment';
};

export type EmailInput = {
  to: string;
  subject: string;
  text: string;
  html?: string;
  attachments?: EmailAttachment[];
};

export type EmailResult = {
  enviado: boolean;
  idMensajeExterno?: string;
  error?: string;
  permanente?: boolean;
};

/**
 * Realiza el envío real de correo a través del transporte Nodemailer SMTP configurado.
 */
export const enviarCorreoSmtp = async (input: EmailInput): Promise<EmailResult> => {
  if (!env.SMTP_ENABLED || !transportCorreo) {
    return {
      enviado: false,
      error: 'Servidor SMTP no configurado o deshabilitado (SMTP_ENABLED=false)',
      permanente: false,
    };
  }

  try {
    const info = await transportCorreo.sendMail({
      from: env.SMTP_FROM,
      to: input.to,
      subject: input.subject,
      text: input.text,
      html: input.html,
      attachments: input.attachments,
    });

    return {
      enviado: true,
      idMensajeExterno: info.messageId,
    };
  } catch (error) {
    const permanente = esErrorPermanenteSmtp(error);
    const mensaje = error instanceof Error ? error.message : 'Error desconocido al enviar correo vía SMTP';

    return {
      enviado: false,
      error: mensaje,
      permanente,
    };
  }
};