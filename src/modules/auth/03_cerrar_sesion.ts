import type { Request, Response } from 'express';
import { noAutenticado } from '../../utils/errores';
import { responderSinContenido } from '../../utils/respuesta';
import { revocarSesionActual } from './helper';

export const cerrarSesion = async (req: Request, res: Response) => {
  if (!req.autenticacion) throw noAutenticado();
  await revocarSesionActual(req.autenticacion.sesionId, res);
  responderSinContenido(res);
};
