import type { Request, Response } from 'express';
import { prisma } from '../../db';
import { responder } from '../../utils/respuesta';
import { esquemaId } from './zod';

export const obtenerFormulario = async (req: Request, res: Response) => {
  const { id } = esquemaId.parse(req.params);
  const formulario = await prisma.formulario.findUniqueOrThrow({
    where: { id },
    include: {
      versiones: {
        orderBy: { numeroVersion: 'desc' },
        include: {
          secciones: {
            include: { preguntas: { orderBy: { orden: 'asc' } } },
            orderBy: { orden: 'asc' },
          },
        },
      },
    },
  });

  responder(res, { formulario });
};
