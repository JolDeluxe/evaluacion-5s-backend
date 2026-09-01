import type { PrismaTransaction } from '../../db';
import type { RolUsuario } from '../../generated/prisma/enums';
import { prohibido, solicitudInvalida } from '../../utils/errores';
import { puedeAdministrar5S, puedeEjecutarAuditoria } from '../../utils/permisos';

export const validarAuditorAsignable = async (
  tx: PrismaTransaction,
  auditorId: number,
  objetivoAuditoriaId: number,
) => {
  const [auditor, objetivo] = await Promise.all([
    tx.usuario.findUniqueOrThrow({
      where: { id: auditorId },
      select: { id: true, rol: true, activo: true, nombre: true },
    }),
    tx.objetivoAuditoria.findUniqueOrThrow({
      where: { id: objetivoAuditoriaId },
      select: { id: true, areaId: true, nombreAreaSnapshot: true },
    }),
  ]);

  if (!auditor.activo) throw solicitudInvalida('El auditor seleccionado no esta activo');
  if (!puedeEjecutarAuditoria(auditor.rol)) {
    throw prohibido('El usuario seleccionado no puede realizar auditorias');
  }

  const perteneceAlArea = await tx.usuarioArea.findFirst({
    where: {
      usuarioId: auditorId,
      areaId: objetivo.areaId,
    },
    select: { id: true },
  });

  if (perteneceAlArea) {
    throw solicitudInvalida('El auditor no puede auditar su propia area');
  }

  return { auditor, objetivo };
};

export const puedeUsarAsignacionEjecutable = (
  autenticacion: { usuarioId: number; rol: RolUsuario } | undefined,
  auditorId: number,
) => Boolean(
  autenticacion
    && (puedeAdministrar5S(autenticacion.rol) || autenticacion.usuarioId === auditorId),
);
