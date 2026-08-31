import type { Request, Response } from 'express';
import { responder } from '../../utils/respuesta';
import { transaccionSerializable } from '../../utils/transaccion';
import { asegurarProgramacionMensual, obtenerVistaMensual } from './programacion_mensual';
import { esquemaMes } from './zod';

export const obtenerCargaMensual = async (req: Request, res: Response) => {
  const query = esquemaMes.parse(req.query);
  const usuarioId = req.autenticacion?.usuarioId ?? 1;
  const vista = await transaccionSerializable(async (tx) => {
    await asegurarProgramacionMensual(tx, query.anio, query.mes, usuarioId);
    return obtenerVistaMensual(tx, query.anio, query.mes);
  });
  responder(res, { anio: query.anio, mes: query.mes, auditores: vista.auditores });
};
