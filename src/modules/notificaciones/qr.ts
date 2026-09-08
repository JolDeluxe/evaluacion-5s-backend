import QRCode from 'qrcode';

/**
 * Genera un Buffer PNG con el código QR para el texto o URL proporcionado.
 */
export const generarQrBuffer = async (textoOUrl: string): Promise<Buffer> => {
  return QRCode.toBuffer(textoOUrl, {
    type: 'png',
    width: 220,
    margin: 2,
    errorCorrectionLevel: 'M',
    color: {
      dark: '#0f172a',
      light: '#ffffff',
    },
  });
};