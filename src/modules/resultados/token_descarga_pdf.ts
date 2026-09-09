import { env } from '../../config/env';
import { compararSeguro, firmarHmacSha256Base64Url } from '../../utils/crypto';
import { noAutenticado } from '../../utils/errores';

export type ContextoDescargaPdf = {
  tipo: 'mes';
  mes: string;
  usuarioId?: number;
  exp: number; // Unix timestamp en segundos
};

// Duración por defecto del enlace firmado: 30 días
export const DIAS_EXPIRACION_TOKEN_PDF = 30;

export const crearTokenDescargaPdf = (datos: {
  tipo: 'mes';
  mes: string;
  usuarioId?: number;
  diasValidez?: number;
}): string => {
  const dias = datos.diasValidez ?? DIAS_EXPIRACION_TOKEN_PDF;
  const exp = Math.floor(Date.now() / 1000) + dias * 24 * 60 * 60;
  const payload: ContextoDescargaPdf = {
    tipo: datos.tipo,
    mes: datos.mes,
    usuarioId: datos.usuarioId,
    exp,
  };
  const payloadBase64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const firma = firmarHmacSha256Base64Url(payloadBase64, env.COOKIE_SECRET);
  return `${payloadBase64}.${firma}`;
};

export const verificarTokenDescargaPdf = (token: string): ContextoDescargaPdf => {
  const [payloadBase64, firmaRecibida] = token.split('.');
  if (!payloadBase64 || !firmaRecibida) {
    throw noAutenticado('Token de descarga inválido');
  }

  const firmaEsperada = firmarHmacSha256Base64Url(payloadBase64, env.COOKIE_SECRET);
  if (!compararSeguro(firmaRecibida, firmaEsperada)) {
    throw noAutenticado('Firma de token de descarga no válida');
  }

  let payload: ContextoDescargaPdf;
  try {
    payload = JSON.parse(Buffer.from(payloadBase64, 'base64url').toString('utf8'));
  } catch {
    throw noAutenticado('Formato de token de descarga no válido');
  }

  if (payload.tipo !== 'mes' || !/^\d{4}-\d{2}$/.test(payload.mes)) {
    throw noAutenticado('Parámetros de token de descarga inválidos');
  }

  if (payload.exp < Math.floor(Date.now() / 1000)) {
    throw noAutenticado('El enlace de descarga ha expirado (validez superada)');
  }

  return payload;
};
