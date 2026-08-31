import type { Request, Response } from 'express';
import { prisma } from '../../db';
import { responder } from '../../utils/respuesta';
import { obtenerResultadosAreas } from './servicio';

export const resultadosAreas = async (req: Request, res: Response) => {
  const resultado = await obtenerResultadosAreas(prisma, req.autenticacion, req.query);
  responder(res, resultado);
};
