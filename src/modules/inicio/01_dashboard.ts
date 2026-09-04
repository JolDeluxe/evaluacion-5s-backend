import type { Request, Response } from 'express';
import { prisma } from '../../db';
import { noAutenticado } from '../../utils/errores';
import { responder } from '../../utils/respuesta';
import { obtenerDashboardInicio } from './servicio';

export const dashboardInicio = async (req: Request, res: Response) => {
  if (!req.autenticacion) throw noAutenticado();

  const datos = await obtenerDashboardInicio(prisma, {
    usuarioId: req.autenticacion.usuarioId,
    rol: req.autenticacion.rol,
  });

  responder(res, datos);
};
