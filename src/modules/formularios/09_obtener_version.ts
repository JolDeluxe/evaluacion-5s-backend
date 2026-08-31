import type { Request, Response } from 'express';
import { prisma } from '../../db';
import { responder } from '../../utils/respuesta';
import { includeRevisionFormularioConEstructura, mapearRevisionFormulario } from './helper';
import { esquemaVersionId } from './zod';

export const obtenerVersionFormulario = async (req: Request, res: Response) => {
  const { versionId } = esquemaVersionId.parse(req.params);
  const version = await prisma.versionFormulario.findUniqueOrThrow({
    where: { id: versionId },
    include: {
      formulario: true,
      ...includeRevisionFormularioConEstructura,
    },
  });

  responder(res, {
    revision: {
      ...mapearRevisionFormulario(version),
      formulario: {
        id: version.formulario.id,
        nombre: version.formulario.nombre,
        descripcion: version.formulario.descripcion,
        alcance: version.formulario.alcance,
        activo: version.formulario.activo,
      },
    },
  });
};
