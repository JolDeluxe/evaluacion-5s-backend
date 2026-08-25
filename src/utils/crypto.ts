import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';

export const generarTokenSeguro = (bytes = 32) => randomBytes(bytes).toString('base64url');

export const hashSha256 = (valor: string) => createHash('sha256').update(valor).digest('hex');

export const generarUuid = () => randomUUID();

export const firmarHmacSha256Base64Url = (contenido: string, secreto: string) =>
  createHmac('sha256', secreto).update(contenido).digest('base64url');

export const compararSeguro = (a: string, b: string) => {
  const bufferA = Buffer.from(a);
  const bufferB = Buffer.from(b);
  if (bufferA.length !== bufferB.length) return false;
  return timingSafeEqual(bufferA, bufferB);
};

export const normalizarNombreUsuario = (valor: string) => valor.trim().toLowerCase();

export const normalizarCorreo = (valor?: string | null) => {
  const limpio = valor?.trim().toLowerCase();
  return limpio || null;
};

const contrasenasBloqueadas = new Set(['123456', 'abcdef', 'password', 'qwerty', 'admin123']);

export const validarContrasena = (contrasena: string) => {
  if (contrasena.length < 6) return 'La contrasena debe tener al menos 6 caracteres';
  if (contrasena.length > 128) return 'La contrasena no debe exceder 128 caracteres';
  if (contrasenasBloqueadas.has(contrasena.trim().toLowerCase())) {
    return 'La contrasena es demasiado obvia';
  }
  return null;
};

export const hashContrasena = (contrasena: string) =>
  Bun.password.hash(contrasena, { algorithm: 'argon2id' });

export const verificarContrasena = (contrasena: string, hash: string) => Bun.password.verify(contrasena, hash);
