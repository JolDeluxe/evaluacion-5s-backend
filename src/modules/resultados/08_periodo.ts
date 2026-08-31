import type { Request, Response } from 'express';
import { prisma } from '../../db';
import { responder } from '../../utils/respuesta';
import { obtenerResultadoPeriodo } from './servicio';
import { esquemaPeriodoResultados } from './zod';

export const resultadoPeriodo = async (req: Request, res: Response) => {
  const { areaId, periodo } = esquemaPeriodoResultados.parse(req.params);
  const resultado = await obtenerResultadoPeriodo(prisma, req.autenticacion, areaId, periodo, req.query);
  responder(res, resultado);
};
