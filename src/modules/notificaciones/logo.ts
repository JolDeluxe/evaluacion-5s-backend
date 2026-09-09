import fs from 'fs';
import path from 'path';
import type { EmailAttachment } from './proveedores/email-smtp';

const RUTA_LOGO = path.resolve(__dirname, '../../../public/img/01_Cuadra.png');

/**
 * Devuelve el objeto EmailAttachment necesario para adjuntar el logo corporativo de Cuadra como imagen inline (CID).
 */
export const obtenerAdjuntoLogoCuadra = (): EmailAttachment | null => {
  try {
    if (!fs.existsSync(RUTA_LOGO)) return null;
    const content = fs.readFileSync(RUTA_LOGO);
    return {
      filename: 'logo-cuadra.png',
      content,
      cid: 'logo-cuadra',
      contentType: 'image/png',
      contentDisposition: 'inline',
    };
  } catch {
    return null;
  }
};

/**
 * Sustituye el identificador 'src="cid:logo-cuadra"' por un Data URI Base64 en el HTML.
 * Útil para previsualizar plantillas en modales / iframe sin necesidad de servidor SMTP.
 */
export const reemplazarLogoDataUri = (html: string): string => {
  try {
    if (!fs.existsSync(RUTA_LOGO)) return html;
    const content = fs.readFileSync(RUTA_LOGO);
    const dataUri = `data:image/png;base64,${content.toString('base64')}`;
    return html.replace(/src="cid:logo-cuadra"/g, `src="${dataUri}"`);
  } catch {
    return html;
  }
};
