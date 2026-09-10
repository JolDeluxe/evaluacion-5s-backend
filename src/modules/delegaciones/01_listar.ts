import type { Request, Response } from 'express';
import { prisma } from '../../db';
import { responder } from '../../utils/respuesta';
import { esquemaListarDelegaciones } from './zod';

export const listarDelegaciones = async (req: Request, res: Response) => {
  const query = esquemaListarDelegaciones.parse(req.query);

  const delegaciones = await prisma.delegacionCumplimiento.findMany({
    where: {
      ...(query.ejecutorId ? { ejecutorId: query.ejecutorId } : {}),
      ...(query.responsableId ? { responsableId: query.responsableId } : {}),
      ...(query.activa !== undefined ? { activa: query.activa } : {}),
    },
    include: {
      ejecutor: {
        select: {
          id: true,
          nombre: true,
          nombreUsuario: true,
          correo: true,
          rol: true,
          activo: true,
        },
      },
      responsable: {
        select: {
          id: true,
          nombre: true,
          nombreUsuario: true,
          correo: true,
          rol: true,
          activo: true,
        },
      },
    },
    orderBy: [
      { activa: 'desc' },
      { vigenteDesde: 'desc' },
      { id: 'desc' },
    ],
  });

  responder(res, delegaciones);
};
