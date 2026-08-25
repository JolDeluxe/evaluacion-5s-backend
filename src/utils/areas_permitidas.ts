import type { PrismaTransaction } from '../db';
import { RolUsuario } from '../generated/prisma/enums';
import { puedeAdministrar5S } from './permisos';

export const obtenerAreaIdsConDetalle = async (
  tx: PrismaTransaction,
  autenticacion: { usuarioId: number; rol: RolUsuario } | undefined,
) => {
  if (!autenticacion) return [];
  if (puedeAdministrar5S(autenticacion.rol)) return null;

  const relaciones = await tx.usuarioArea.findMany({
    where: {
      usuarioId: autenticacion.usuarioId,
    },
    select: { areaId: true },
  });

  return relaciones.map((relacion) => relacion.areaId);
};

export const tieneDetalleDeArea = async (
  tx: PrismaTransaction,
  autenticacion: { usuarioId: number; rol: RolUsuario } | undefined,
  areaId: number,
) => {
  const areaIds = await obtenerAreaIdsConDetalle(tx, autenticacion);
  return areaIds === null || areaIds.includes(areaId);
};
