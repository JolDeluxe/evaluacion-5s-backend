import type { NextFunction, Request, Response } from 'express';
import type { RolUsuario } from '../generated/prisma/enums';
import { prohibido } from '../utils/errores';

export const autorizarRoles = (...roles: RolUsuario[]) => (
  req: Request,
  _res: Response,
  next: NextFunction
) => {
  const autenticacion = req.autenticacion;
  if (!autenticacion || !roles.includes(autenticacion.rol)) throw prohibido();
  next();
};
