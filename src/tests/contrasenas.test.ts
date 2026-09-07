import { describe, expect, test } from 'bun:test';
import {
  desencriptarCredencial,
  prepararCamposContrasena,
} from '../utils/cifrado-credencial';
import { verificarContrasena } from '../utils/crypto';

describe('Credenciales recuperables', () => {
  test('prepara Argon2id y AES-256-GCM para la misma contraseña', async () => {
    const password = `Prueba-${crypto.randomUUID()}`;
    const fields = await prepararCamposContrasena(password);

    expect(fields.hashContrasena).toStartWith('$argon2id$');
    expect(fields.credencialCifrada).toStartWith('v1:');
    expect(fields.credencialCifrada).not.toContain(password);
    expect(await verificarContrasena(password, fields.hashContrasena)).toBe(true);
    expect(desencriptarCredencial(fields.credencialCifrada)).toBe(password);
  });
});
