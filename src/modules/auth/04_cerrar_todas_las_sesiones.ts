import type { Request, Response } from 'express';
import { limpiarCookieSesion } from '../../config/cookies';
import { prisma } from '../../db';
import { noAutenticado } from '../../utils/errores';
import { responderSinContenido } from '../../utils/respuesta';

export const cerrarTodasLasSesiones = async (req: Request, res: Response) => {
  if (!req.autenticacion) throw noAutenticado();
  await prisma.sesion.updateMany({
    where: { usuarioId: req.autenticacion.usuarioId, revocadoEn: null },
    data: { revocadoEn: new Date() },
  });
  limpiarCookieSesion(res);
  responderSinContenido(res);
};
