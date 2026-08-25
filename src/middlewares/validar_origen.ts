import type { NextFunction, Request, Response } from 'express';
import { env } from '../config/env';
import { prohibido } from '../utils/errores';

const metodosProtegidos = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export const validarOrigen = (req: Request, _res: Response, next: NextFunction) => {
  if (!metodosProtegidos.has(req.method)) {
    next();
    return;
  }

  const origin = req.get('origin');
  if (!origin || origin === env.FRONTEND_ORIGIN) {
    next();
    return;
  }

  throw prohibido('Origen no permitido');
};
