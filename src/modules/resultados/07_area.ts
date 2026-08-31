import type { Request, Response } from 'express';
import { prisma } from '../../db';
import { responder } from '../../utils/respuesta';
import { obtenerResultadoArea } from './servicio';
import { esquemaAreaResultados } from './zod';

export const resultadoArea = async (req: Request, res: Response) => {
  const { areaId } = esquemaAreaResultados.parse(req.params);
  const resultado = await obtenerResultadoArea(prisma, req.autenticacion, areaId, req.query);
  responder(res, resultado);
};
