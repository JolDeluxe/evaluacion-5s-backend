import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { env } from '../config/env';

const PREFIX = 'v1:';

function getMasterKey(): Buffer {
  const keyString = env.EMAIL_TOKEN_ENCRYPTION_KEY || env.CREDENTIALS_ENCRYPTION_KEY;
  return Buffer.from(keyString, 'base64');
}

export function encriptarTokenEmail(textoPlano: string): string {
  const masterKey = getMasterKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', masterKey, iv);

  let encrypted = cipher.update(textoPlano, 'utf8', 'base64');
  encrypted += cipher.final('base64');
  const tag = cipher.getAuthTag().toString('base64');

  return `${PREFIX}${iv.toString('base64')}:${tag}:${encrypted}`;
}

export function desencriptarTokenEmail(payload: string): string {
  if (!payload.startsWith(PREFIX)) {
    throw new Error('Formato de token encriptado no soportado');
  }
  const parts = payload.slice(PREFIX.length).split(':');
  if (parts.length !== 3) {
    throw new Error('Formato de token encriptado inválido');
  }

  const [ivBase64, tagBase64, ciphertextBase64] = parts;
  const masterKey = getMasterKey();
  const iv = Buffer.from(ivBase64, 'base64');
  const tag = Buffer.from(tagBase64, 'base64');
  const decipher = createDecipheriv('aes-256-gcm', masterKey, iv);
  decipher.setAuthTag(tag);

  let decrypted = decipher.update(ciphertextBase64, 'base64', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}