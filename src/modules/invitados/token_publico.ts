import { createHmac } from 'node:crypto';
import { env } from '../../config/env';
import { compararSeguro } from '../../utils/crypto';
import { noAutenticado, servicioNoDisponible } from '../../utils/errores';

export type ContextoInvitadoPublico = {
  objetivoAuditoriaId: number;
  areaId: number;
  nombreInvitado: string;
  exp: number;
};

export const asegurarInvitadoPublicoHabilitado = () => {
  if (!env.INVITADO_PUBLICO_ENABLED || !env.INVITADO_PUBLICO_SECRET) {
    throw servicioNoDisponible('El invitado publico no esta habilitado');
  }
  return env.INVITADO_PUBLICO_SECRET;
};

const firmar = (payloadBase64: string) =>
  createHmac('sha256', asegurarInvitadoPublicoHabilitado()).update(payloadBase64).digest('base64url');

export const crearContextoInvitadoPublico = (
  datos: Omit<ContextoInvitadoPublico, 'exp'>
) => {
  const exp = Math.floor(Date.now() / 1000) + env.INVITADO_PUBLICO_EXPIRA_HORAS * 60 * 60;
  const payloadBase64 = Buffer.from(JSON.stringify({ ...datos, exp })).toString('base64url');
  const firma = firmar(payloadBase64);
  return `${payloadBase64}.${firma}`;
};

export const verificarContextoInvitadoPublico = (token: string): ContextoInvitadoPublico => {
  const [payloadBase64, firmaRecibida] = token.split('.');
  if (!payloadBase64 || !firmaRecibida) throw noAutenticado('Contexto invitado invalido');

  const firmaEsperada = firmar(payloadBase64);
  if (!compararSeguro(firmaRecibida, firmaEsperada)) throw noAutenticado('Contexto invitado invalido');

  const payload = JSON.parse(Buffer.from(payloadBase64, 'base64url').toString('utf8')) as ContextoInvitadoPublico;
  if (!Number.isInteger(payload.objetivoAuditoriaId) || !Number.isInteger(payload.areaId) || !payload.nombreInvitado) {
    throw noAutenticado('Contexto invitado invalido');
  }
  if (payload.exp < Math.floor(Date.now() / 1000)) throw noAutenticado('Contexto invitado expirado');
  return payload;
};
