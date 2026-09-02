import type { Request, Response } from 'express';
import { responder } from '../../utils/respuesta';
import { transaccionSerializable } from '../../utils/transaccion';
import {
  asegurarProgramacionMensual,
  calcularPropuestaAutoasignacion,
  confirmarPropuestaAutoasignacion as confirmarEnTransaccion,
  obtenerVistaMensual,
} from './programacion_mensual';
import { esquemaAutoasignarMensual, esquemaConfirmarAutoasignacion } from './zod';

export const generarPropuestaAutoasignacion = async (req: Request, res: Response) => {
  const body = esquemaAutoasignarMensual.parse(req.body);
  const usuarioId = req.autenticacion?.usuarioId ?? 1;

  const resultado = await transaccionSerializable(async (tx) => {
    await asegurarProgramacionMensual(tx, body.anio, body.mes, usuarioId);
    return calcularPropuestaAutoasignacion(tx, body.anio, body.mes);
  });

  responder(res, resultado);
};

export const confirmarAutoasignacion = async (req: Request, res: Response) => {
  const body = esquemaConfirmarAutoasignacion.parse(req.body);
  const usuarioId = req.autenticacion?.usuarioId ?? 1;

  const resultado = await transaccionSerializable(async (tx) => {
    await asegurarProgramacionMensual(tx, body.anio, body.mes, usuarioId);
    const confirmacion = await confirmarEnTransaccion(tx, body.anio, body.mes, body.asignaciones, usuarioId);
    const vista = await obtenerVistaMensual(tx, body.anio, body.mes);
    return { confirmacion, vista };
  });

  responder(res, resultado);
};
