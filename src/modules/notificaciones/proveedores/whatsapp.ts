import { env } from '../../../config/env';

export const enviarWhatsapp = async (_destino: string, _mensaje: string) => {
  if (!env.WHATSAPP_ENABLED) return { enviado: false, error: 'WhatsApp no habilitado' };
  return { enviado: false, error: 'Proveedor WhatsApp no configurado' };
};
