import type { Request, Response } from 'express';
import { prisma } from '../../db';
import { responder } from '../../utils/respuesta';
import { obtenerVistaMensualCumplimientos } from './servicio_kpi';
import { esquemaQueryCumplimientos } from './zod';

export const obtenerCumplimientosMensual = async (req: Request, res: Response) => {
  const query = esquemaQueryCumplimientos.parse(req.query);
  const ahora = new Date();

  const anio = query.anio ?? ahora.getFullYear();
  const mes = query.mes ?? (ahora.getMonth() + 1);

  const datos = await obtenerVistaMensualCumplimientos(prisma, anio, mes);
  responder(res, datos);
};
