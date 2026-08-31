import type { Request, Response } from 'express';
import { responder } from '../../utils/respuesta';
import { transaccionSerializable } from '../../utils/transaccion';
import { asegurarProgramacionMensual, obtenerVistaMensual } from './programacion_mensual';
import { esquemaQueryMensual } from './zod';

export const obtenerAsignacionesMensuales = async (req: Request, res: Response) => {
  const query = esquemaQueryMensual.parse(req.query);
  const usuarioId = req.autenticacion?.usuarioId ?? 1;

  const vista = await transaccionSerializable(async (tx) => {
    await asegurarProgramacionMensual(tx, query.anio, query.mes, usuarioId);
    return obtenerVistaMensual(tx, query.anio, query.mes, query);
  });

  responder(res, vista);
};
