import type { Request, Response } from 'express';
import { responder } from '../../utils/respuesta';
import { transaccionSerializable } from '../../utils/transaccion';
import { asegurarProgramacionMensual, autoasignarPendientes, obtenerVistaMensual } from './programacion_mensual';
import { esquemaAutoasignarMensual } from './zod';

export const autoasignarMensual = async (req: Request, res: Response) => {
  const body = esquemaAutoasignarMensual.parse(req.body);
  const usuarioId = req.autenticacion?.usuarioId ?? 1;

  const resultado = await transaccionSerializable(async (tx) => {
    await asegurarProgramacionMensual(tx, body.anio, body.mes, usuarioId);
    const autoasignacion = await autoasignarPendientes(tx, body.anio, body.mes, usuarioId);
    const vista = await obtenerVistaMensual(tx, body.anio, body.mes);
    return { autoasignacion, vista };
  });

  responder(res, resultado);
};
