import type { Request, Response } from 'express';
import { prisma } from '../../db';
import { responder } from '../../utils/respuesta';
import { liquidarCumplimientosMensuales } from './servicio_kpi';
import { esquemaRecalcular } from './zod';

export const recalcularCumplimientos = async (req: Request, res: Response) => {
  const body = esquemaRecalcular.parse(req.body);
  const resultados = await liquidarCumplimientosMensuales(prisma, body.anio, body.mes);
  responder(res, { recalculados: resultados.length, mes: `${body.anio}-${body.mes}` });
};
