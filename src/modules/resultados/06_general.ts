import type { Request, Response } from 'express';
import { prisma } from '../../db';
import { responder } from '../../utils/respuesta';
import { obtenerResultadosGeneral } from './servicio';
import { esquemaResultadosGeneralQuery } from './zod';
import { solicitudInvalida } from '../../utils/errores';

export const resultadosGeneral = async (req: Request, res: Response) => {
  const parseResult = esquemaResultadosGeneralQuery.safeParse(req.query);
  if (!parseResult.success) {
    throw solicitudInvalida('Parámetros de consulta para resultados general no válidos');
  }
  const resultado = await obtenerResultadosGeneral(prisma, req.autenticacion, parseResult.data);
  responder(res, resultado);
};
