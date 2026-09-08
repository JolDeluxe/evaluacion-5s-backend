import { env } from '../../../config/env';
import type { EmailInput, EmailResult } from './email-smtp';
import { enviarCorreoSmtp } from './email-smtp';
import { enviarCorreoMicrosoftGraph } from './microsoft-graph';

export type { EmailAttachment, EmailInput, EmailResult } from './email-smtp';

/**
 * Despacha el correo según el proveedor configurado (microsoft_graph o smtp).
 */
export const despacharSegunProveedor = async (input: EmailInput): Promise<EmailResult & { retryAfterSeconds?: number }> => {
  if (env.EMAIL_PROVIDER === 'microsoft_graph') {
    return enviarCorreoMicrosoftGraph(input);
  }

  return enviarCorreoSmtp(input);
};

/**
 * Punto de entrada principal para el envío automático de correos en el worker.
 * Respeta el feature flag EMAIL_ENABLED. Si está en false, no se realiza el envío.
 */
export const enviarCorreo = async (input: EmailInput): Promise<EmailResult & { retryAfterSeconds?: number }> => {
  if (!env.EMAIL_ENABLED) {
    return {
      enviado: false,
      error: 'EMAIL_ENABLED=false — servicio de correo pausado por configuración',
      permanente: false,
    };
  }

  return despacharSegunProveedor(input);
};

/**
 * Envío directo utilizado exclusivamente para pruebas controladas de SUPER_ADMIN.
 * No requiere que el worker automático esté activo (EMAIL_ENABLED), pero sí requiere EMAIL_TEST_ENABLED=true.
 */
export const enviarCorreoDirecto = async (input: EmailInput): Promise<EmailResult & { retryAfterSeconds?: number }> => {
  return despacharSegunProveedor(input);
};