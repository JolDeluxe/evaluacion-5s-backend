import { describe, expect, test } from 'bun:test';
import { RolUsuario } from '../generated/prisma/enums';
import { assertPuedeGestionarRolUsuario, assertNoQuitaUltimoSuperAdmin } from '../modules/usuarios/helper';
import { esquemaActualizarUsuario } from '../modules/usuarios/zod';
import { ErrorApi } from '../utils/errores';

describe('Reglas de autorización y gestión de roles de usuarios', () => {
  const fakeTx = {
    usuario: {
      count: async () => 1,
    },
  } as any;

  const fakeTxUltimo = {
    usuario: {
      count: async () => 0,
    },
  } as any;

  test('ADMINISTRADOR intentando crear usuario con rol SUPER_ADMIN es rechazado con 403 (prohibido)', async () => {
    const actor = { usuarioId: 2, rol: RolUsuario.ADMINISTRADOR };
    const objetivo = { rol: RolUsuario.SUPER_ADMIN };

    try {
      await assertPuedeGestionarRolUsuario(actor, objetivo, fakeTx, 'crear');
      expect.unreachable('Debería haber lanzado un ErrorApi');
    } catch (error) {
      expect(error).toBeInstanceOf(ErrorApi);
      expect((error as ErrorApi).estado).toBe(403);
      expect((error as ErrorApi).codigo).toBe('PROHIBIDO');
    }
  });

  test('ADMINISTRADOR intentando actualizar un usuario existente para asignarle rol SUPER_ADMIN es rechazado con 403', async () => {
    const actor = { usuarioId: 2, rol: RolUsuario.ADMINISTRADOR };
    const objetivo = { id: 10, rol: RolUsuario.SUPER_ADMIN, activo: true };

    try {
      await assertPuedeGestionarRolUsuario(actor, objetivo, fakeTx, 'actualizar');
      expect.unreachable('Debería haber lanzado un ErrorApi');
    } catch (error) {
      expect(error).toBeInstanceOf(ErrorApi);
      expect((error as ErrorApi).estado).toBe(403);
      expect((error as ErrorApi).codigo).toBe('PROHIBIDO');
    }
  });

  test('ADMINISTRADOR intentando editar o gestionar a un usuario que ya es SUPER_ADMIN es rechazado con 403', async () => {
    const actor = { usuarioId: 2, rol: RolUsuario.ADMINISTRADOR };
    const objetivoSuperAdmin = { id: 1, rol: RolUsuario.SUPER_ADMIN, activo: true };

    try {
      await assertPuedeGestionarRolUsuario(actor, objetivoSuperAdmin, fakeTx, 'actualizar');
      expect.unreachable('Debería haber lanzado un ErrorApi');
    } catch (error) {
      expect(error).toBeInstanceOf(ErrorApi);
      expect((error as ErrorApi).estado).toBe(403);
      expect((error as ErrorApi).codigo).toBe('PROHIBIDO');
    }
  });

  test('SUPER_ADMIN puede asignar rol SUPER_ADMIN', async () => {
    const actor = { usuarioId: 1, rol: RolUsuario.SUPER_ADMIN };
    const objetivo = { id: 10, rol: RolUsuario.SUPER_ADMIN, activo: true };

    await expect(assertPuedeGestionarRolUsuario(actor, objetivo, fakeTx, 'actualizar')).resolves.toBeUndefined();
  });

  test('SUPER_ADMIN editando usuario ADMINISTRADOR sin tocar rol mantiene el rol y no lanza error', async () => {
    const actor = { usuarioId: 1, rol: RolUsuario.SUPER_ADMIN };
    const objetivo = { id: 10, rol: RolUsuario.ADMINISTRADOR, activo: true };

    await expect(assertPuedeGestionarRolUsuario(actor, objetivo, fakeTx, 'actualizar')).resolves.toBeUndefined();
  });

  test('SUPER_ADMIN editando a otro SUPER_ADMIN no lo degrada si hay más SUPER_ADMINs activos', async () => {
    const actor = { usuarioId: 1, rol: RolUsuario.SUPER_ADMIN };
    const objetivo = { id: 1, rol: RolUsuario.SUPER_ADMIN, activo: true };

    await expect(assertPuedeGestionarRolUsuario(actor, objetivo, fakeTx, 'actualizar')).resolves.toBeUndefined();
  });

  test('No se puede quitar el último SUPER_ADMIN activo del sistema', async () => {
    try {
      await assertNoQuitaUltimoSuperAdmin(1, RolUsuario.SUPER_ADMIN, RolUsuario.ADMINISTRADOR, true, fakeTxUltimo);
      expect.unreachable('Debería haber lanzado un ErrorApi');
    } catch (error) {
      expect(error).toBeInstanceOf(ErrorApi);
      expect((error as ErrorApi).estado).toBe(400);
      expect((error as ErrorApi).codigo).toBe('SOLICITUD_INVALIDA');
    }
  });

  test('esquemaActualizarUsuario: si se envía payload sin rol, rol es undefined y no tiene fallback a ADMINISTRADOR', () => {
    const parsed = esquemaActualizarUsuario.parse({
      nombre: 'Nuevo Nombre',
    });
    expect(parsed.rol).toBeUndefined();
    expect(parsed.nombre).toBe('Nuevo Nombre');
  });

  test('esquemaActualizarUsuario: acepta SUPER_ADMIN explícito', () => {
    const parsed = esquemaActualizarUsuario.parse({
      rol: 'SUPER_ADMIN',
    });
    expect(parsed.rol).toBe(RolUsuario.SUPER_ADMIN);
  });
});
