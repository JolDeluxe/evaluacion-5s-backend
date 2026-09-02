import type { Request, Response } from 'express';
import { responder } from '../../utils/respuesta';
import { transaccionSerializable } from '../../utils/transaccion';
import { obtenerPendientesGlobalesDeAsignacion } from './servicio_reasignacion';

export const obtenerPendientesAsignacion = async (req: Request, res: Response) => {
  const pendientes = await transaccionSerializable((tx) => obtenerPendientesGlobalesDeAsignacion(tx));
  const resultado = { pendientes, total: pendientes.length };
  responder(res, resultado);
};
