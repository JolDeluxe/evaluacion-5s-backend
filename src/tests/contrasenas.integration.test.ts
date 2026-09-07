import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { Server } from 'node:http';
import { app } from '../app';
import { env } from '../config/env';
import { prisma } from '../db';
import { RolUsuario } from '../generated/prisma/enums';
import {
  desencriptarCredencial,
  prepararCamposContrasena,
} from '../utils/cifrado-credencial';
import { verificarContrasena } from '../utils/crypto';

const describeIntegration = process.env.RUN_PASSWORD_INTEGRATION === '1' ? describe : describe.skip;

describeIntegration('Contraseñas extremo a extremo', () => {
  let server: Server;
  let baseUrl = '';
  const userIds: number[] = [];
  const suffix = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  const ownUsername = `test-own-${suffix}`;
  const adminUsername = `test-admin-${suffix}`;
  const targetUsername = `test-target-${suffix}`;
  const superUsername = `test-super-${suffix}`;
  const ownOldPassword = `Old-${crypto.randomUUID()}`;
  const ownNewPassword = `New-${crypto.randomUUID()}`;
  const adminPassword = `Admin-${crypto.randomUUID()}`;
  const targetInitialPassword = `Initial-${crypto.randomUUID()}`;
  const targetNewPassword = `Target-${crypto.randomUUID()}`;
  const superPassword = `Super-${crypto.randomUUID()}`;

  const request = (path: string, options: RequestInit = {}) => fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      Accept: 'application/json',
      Origin: env.FRONTEND_ORIGIN,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
  });

  const login = async (username: string, password: string) => {
    const response = await request('/api/v1/auth/iniciar-sesion', {
      method: 'POST',
      body: JSON.stringify({ nombreUsuario: username, contrasena: password }),
    });
    const setCookie = response.headers.get('set-cookie');
    return {
      response,
      cookie: setCookie?.split(';', 1)[0] ?? '',
    };
  };

  const createUser = async (
    username: string,
    password: string,
    rol: RolUsuario,
    recoverable = true,
  ) => {
    const fields = await prepararCamposContrasena(password);
    const user = await prisma.usuario.create({
      data: {
        nombreUsuario: username,
        nombre: `Usuario prueba ${suffix}`,
        rol,
        activo: true,
        debeCambiarContrasena: false,
        hashContrasena: fields.hashContrasena,
        credencialCifrada: recoverable ? fields.credencialCifrada : null,
      },
    });
    userIds.push(user.id);
    return user;
  };

  beforeAll(async () => {
    server = await new Promise<Server>((resolve) => {
      const listeningServer = app.listen(0, '127.0.0.1', () => resolve(listeningServer));
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('No se pudo iniciar el servidor de prueba');
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    if (userIds.length) {
      await prisma.registroAuditoria.deleteMany({
        where: {
          OR: [
            { usuarioId: { in: userIds } },
            { tipoEntidad: 'Usuario', idEntidad: { in: userIds } },
          ],
        },
      });
      await prisma.sesion.deleteMany({ where: { usuarioId: { in: userIds } } });
      await prisma.tokenRestablecimientoContrasena.deleteMany({ where: { usuarioId: { in: userIds } } });
      await prisma.usuario.deleteMany({ where: { id: { in: userIds } } });
    }
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  test('el cambio propio conserva la sesión y sustituye autenticación y credencial', async () => {
    const ownUser = await createUser(ownUsername, ownOldPassword, RolUsuario.AUDITOR);
    const { response: loginResponse, cookie } = await login(ownUsername, ownOldPassword);
    expect(loginResponse.status).toBe(200);
    expect(cookie).not.toBe('');

    const changeResponse = await request('/api/v1/auth/cambiar-contrasena', {
      method: 'POST',
      headers: { Cookie: cookie },
      body: JSON.stringify({
        contrasenaActual: ownOldPassword,
        contrasenaNueva: ownNewPassword,
      }),
    });
    expect(changeResponse.status).toBe(200);

    const storedUser = await prisma.usuario.findUniqueOrThrow({ where: { id: ownUser.id } });
    expect(storedUser.credencialCifrada).not.toBeNull();
    expect(await verificarContrasena(ownOldPassword, storedUser.hashContrasena)).toBe(false);
    expect(await verificarContrasena(ownNewPassword, storedUser.hashContrasena)).toBe(true);
    expect(desencriptarCredencial(storedUser.credencialCifrada!)).toBe(ownNewPassword);

    const credentialResponse = await request('/api/v1/auth/me/credencial', {
      headers: { Cookie: cookie },
    });
    expect(credentialResponse.status).toBe(200);
    expect(credentialResponse.headers.get('cache-control')).toContain('no-store');
    expect(credentialResponse.headers.has('etag')).toBe(false);
    const credentialBody = await credentialResponse.json() as { datos: { credencial: string } };
    expect(credentialBody.datos.credencial).toBe(ownNewPassword);

    const meResponse = await request('/api/v1/auth/me', { headers: { Cookie: cookie } });
    expect(meResponse.status).toBe(200);
    const meText = await meResponse.text();
    expect(meText).not.toContain('hashContrasena');
    expect(meText).not.toContain('credencialCifrada');
    expect(meText).not.toContain(ownNewPassword);

    expect((await login(ownUsername, ownOldPassword)).response.status).toBe(401);
    expect((await login(ownUsername, ownNewPassword)).response.status).toBe(200);
  });

  test('el flujo administrativo habilita credencial y respeta la jerarquía', async () => {
    const admin = await createUser(adminUsername, adminPassword, RolUsuario.ADMINISTRADOR);
    const target = await createUser(
      targetUsername,
      targetInitialPassword,
      RolUsuario.AUDITOR,
      false,
    );
    const superAdmin = await createUser(superUsername, superPassword, RolUsuario.SUPER_ADMIN);

    const { response: adminLoginResponse, cookie: adminCookie } = await login(adminUsername, adminPassword);
    expect(adminLoginResponse.status).toBe(200);

    const unavailableResponse = await request(`/api/v1/usuarios/${target.id}/credencial`, {
      headers: { Cookie: adminCookie },
    });
    expect(unavailableResponse.status).toBe(200);
    const unavailableBody = await unavailableResponse.json() as {
      datos: { tieneCredencial: boolean; credencial: null };
    };
    expect(unavailableBody.datos).toMatchObject({ tieneCredencial: false, credencial: null });

    const resetResponse = await request(`/api/v1/usuarios/${target.id}/contrasena-temporal`, {
      method: 'POST',
      headers: { Cookie: adminCookie },
      body: JSON.stringify({ contrasena: targetNewPassword, debeCambiarContrasena: false }),
    });
    expect(resetResponse.status).toBe(200);

    const storedTarget = await prisma.usuario.findUniqueOrThrow({ where: { id: target.id } });
    expect(storedTarget.credencialCifrada).not.toBeNull();
    expect(await verificarContrasena(targetNewPassword, storedTarget.hashContrasena)).toBe(true);
    expect(desencriptarCredencial(storedTarget.credencialCifrada!)).toBe(targetNewPassword);

    const revealResponse = await request(`/api/v1/usuarios/${target.id}/credencial`, {
      headers: { Cookie: adminCookie },
    });
    expect(revealResponse.status).toBe(200);
    expect(revealResponse.headers.get('cache-control')).toContain('no-store');
    expect(revealResponse.headers.has('etag')).toBe(false);
    const revealBody = await revealResponse.json() as { datos: { credencial: string } };
    expect(revealBody.datos.credencial).toBe(targetNewPassword);

    const listResponse = await request('/api/v1/usuarios?limite=100', {
      headers: { Cookie: adminCookie },
    });
    const listText = await listResponse.text();
    expect(listResponse.status).toBe(200);
    expect(listText).not.toContain('hashContrasena');
    expect(listText).not.toContain('credencialCifrada');
    expect(listText).not.toContain(targetNewPassword);

    const adminOwnCredential = await request('/api/v1/auth/me/credencial', {
      headers: { Cookie: adminCookie },
    });
    expect(adminOwnCredential.status).toBe(200);

    const { cookie: auditorCookie } = await login(ownUsername, ownNewPassword);
    const auditorAdminRequest = await request(`/api/v1/usuarios/${target.id}/credencial`, {
      headers: { Cookie: auditorCookie },
    });
    expect(auditorAdminRequest.status).toBe(403);

    const adminSuperRequest = await request(`/api/v1/usuarios/${superAdmin.id}/credencial`, {
      headers: { Cookie: adminCookie },
    });
    expect(adminSuperRequest.status).toBe(403);

    const { cookie: superCookie } = await login(superUsername, superPassword);
    const superOwnCredential = await request('/api/v1/auth/me/credencial', {
      headers: { Cookie: superCookie },
    });
    expect(superOwnCredential.status).toBe(200);
    const superOwnBody = await superOwnCredential.json() as { datos: { credencial: string } };
    expect(superOwnBody.datos.credencial).toBe(superPassword);

    expect(admin.id).toBeGreaterThan(0);
  });
});
