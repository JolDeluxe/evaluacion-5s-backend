import type { Request, Response } from 'express';
import { prisma } from '../../db';
import { noAutenticado } from '../../utils/errores';
import { responder } from '../../utils/respuesta';
import { esquemaId } from './zod';

export const marcarLeida = async (req: Request, res: Response) => {
  if (!req.autenticacion) throw noAutenticado();
  const { id } = esquemaId.parse(req.params);
  await prisma.notificacion.updateMany({
    where: { id, usuarioId: req.autenticacion.usuarioId },
    data: { leidaEn: new Date() },
  });
  const notificacion = await prisma.notificacion.findFirst({
    where: { id, usuarioId: req.autenticacion.usuarioId },
  });
  responder(res, { notificacion });
};
