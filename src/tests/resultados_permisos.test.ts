import { describe, expect, test } from 'bun:test';
import type { Request, Response } from 'express';

import { autorizarRoles } from '../middlewares/autorizacion';
import { RolUsuario } from '../generated/prisma/enums';
import {
  puedeConsultarResultadosGeneral,
  puedeVerResultadosCompletos,
  ROLES_RESULTADOS_GENERAL,
} from '../utils/permisos';
import { obtenerAreaIdsConDetalle, tieneDetalleDeArea } from '../utils/areas_permitidas';
import type { PrismaTransaction } from '../db';

describe('matriz de permisos de resultados generales', () => {
  test.each([
    RolUsuario.SUPER_ADMIN,
    RolUsuario.ADMINISTRADOR,
    RolUsuario.AUDITOR,
    RolUsuario.VISUALIZADOR,
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

  test('AUDITOR y VISUALIZADOR no obtienen los detalles restringidos', () => {
    expect(puedeVerResultadosCompletos(RolUsuario.AUDITOR)).toBe(false);
    expect(puedeVerResultadosCompletos(RolUsuario.VISUALIZADOR)).toBe(false);
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

  describe('acceso a áreas asignadas (areas_permitidas)', () => {
    const mockTx = {
      usuarioArea: {
        findMany: async ({ where }: { where: { usuarioId: number } }) => {
          if (where.usuarioId === 10) {
            return [{ areaId: 25 }, { areaId: 30 }];
          }
          return [];
        },
      },
    } as unknown as PrismaTransaction;

    test('VISUALIZADOR solo obtiene las áreas asignadas en usuarioArea', async () => {
      const areaIds = await obtenerAreaIdsConDetalle(mockTx, {
        usuarioId: 10,
        rol: RolUsuario.VISUALIZADOR,
      });
      expect(areaIds).toEqual([25, 30]);
    });

    test('VISUALIZADOR puede ver detalle de sus áreas asignadas pero no de ajenas', async () => {
      const auth = { usuarioId: 10, rol: RolUsuario.VISUALIZADOR };
      expect(await tieneDetalleDeArea(mockTx, auth, 25)).toBe(true);
      expect(await tieneDetalleDeArea(mockTx, auth, 30)).toBe(true);
      expect(await tieneDetalleDeArea(mockTx, auth, 99)).toBe(false);
    });

    test('ADMINISTRADOR y SUPER_ADMIN tienen acceso a todas las áreas (retornan null)', async () => {
      const adminAuth = { usuarioId: 1, rol: RolUsuario.ADMINISTRADOR };
      const superAuth = { usuarioId: 2, rol: RolUsuario.SUPER_ADMIN };

      expect(await obtenerAreaIdsConDetalle(mockTx, adminAuth)).toBeNull();
      expect(await tieneDetalleDeArea(mockTx, adminAuth, 999)).toBe(true);

      expect(await obtenerAreaIdsConDetalle(mockTx, superAuth)).toBeNull();
      expect(await tieneDetalleDeArea(mockTx, superAuth, 999)).toBe(true);
    });

    test('sin autenticación no se permite detalle', async () => {
      expect(await obtenerAreaIdsConDetalle(mockTx, undefined)).toEqual([]);
      expect(await tieneDetalleDeArea(mockTx, undefined, 25)).toBe(false);
    });
  });
});
