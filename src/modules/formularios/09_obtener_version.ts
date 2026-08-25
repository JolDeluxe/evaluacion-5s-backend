import type { Request, Response } from 'express';
import { prisma } from '../../db';
import { responder } from '../../utils/respuesta';
import { esquemaVersionId } from './zod';

export const obtenerVersionFormulario = async (req: Request, res: Response) => {
  const { versionId } = esquemaVersionId.parse(req.params);
  const version = await prisma.versionFormulario.findUniqueOrThrow({
    where: { id: versionId },
    include: {
      formulario: true,
      secciones: {
        include: { preguntas: { orderBy: { orden: 'asc' } } },
        orderBy: { orden: 'asc' },
      },
    },
  });

  responder(res, { version });
};
