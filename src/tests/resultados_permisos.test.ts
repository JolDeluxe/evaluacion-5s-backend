import { describe, expect, test } from 'bun:test';
import type { Request, Response } from 'express';

import { autorizarRoles } from '../middlewares/autorizacion';
import { RolUsuario } from '../generated/prisma/enums';
import {
  puedeConsultarResultadosGeneral,
  puedeVerResultadosCompletos,
  ROLES_RESULTADOS_GENERAL,
} from '../utils/permisos';

describe('matriz de permisos de resultados generales', () => {
  test.each([
    RolUsuario.SUPER_ADMIN,
    RolUsuario.ADMINISTRADOR,
    RolUsuario.AUDITOR,
  ])('%s puede consultar resultados generales', (rol) => {
    expect(puedeConsultarResultadosGeneral(rol)).toBe(true);

    let autorizado = false;
    autorizarRoles(...ROLES_RESULTADOS_GENERAL)(
      { autenticacion: { usuarioId: 1, rol } } as unknown as Request,
      {} as Response,
      () => { autorizado = true; },
    );
    expect(autorizado).toBe(true);
  });

  test('AUDITOR no obtiene los detalles restringidos', () => {
    expect(puedeVerResultadosCompletos(RolUsuario.AUDITOR)).toBe(false);
    expect(puedeVerResultadosCompletos(RolUsuario.ADMINISTRADOR)).toBe(true);
    expect(puedeVerResultadosCompletos(RolUsuario.SUPER_ADMIN)).toBe(true);
  });

  test('una petición sin rol autenticado sigue bloqueada', () => {
    expect(puedeConsultarResultadosGeneral(undefined)).toBe(false);
    expect(() => autorizarRoles(...ROLES_RESULTADOS_GENERAL)(
      {} as Request,
      {} as Response,
      () => {},
    )).toThrow();
  });
});
