import type { Request, Response } from 'express';
import { prisma } from '../../db';
import { responder } from '../../utils/respuesta';
import { esquemaId } from './zod';

export const listarVersiones = async (req: Request, res: Response) => {
  const { id } = esquemaId.parse(req.params);
  const versiones = await prisma.versionFormulario.findMany({
    where: { formularioId: id },
    include: {
      secciones: {
        include: { preguntas: { orderBy: { orden: 'asc' } } },
        orderBy: { orden: 'asc' },
      },
    },
    orderBy: { numeroVersion: 'desc' },
  });
  responder(res, { versiones });
};
