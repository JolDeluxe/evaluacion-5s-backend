import type { Request, Response } from 'express';
import { responder } from '../../utils/respuesta';
import { transaccionSerializable } from '../../utils/transaccion';
import { asegurarProgramacionMensualParaLectura, obtenerVistaMensual, puedeAsegurarProgramacionMensual } from './programacion_mensual';
import { esquemaQueryMensual } from './zod';

export const obtenerAsignacionesMensuales = async (req: Request, res: Response) => {
  const query = esquemaQueryMensual.parse(req.query);
  const usuarioId = req.autenticacion?.usuarioId ?? 1;

  const vista = await transaccionSerializable(async (tx) => {
    let configuracion = null;
    if (puedeAsegurarProgramacionMensual(query.anio, query.mes)) {
      configuracion = await asegurarProgramacionMensualParaLectura(tx, query.anio, query.mes, usuarioId);
    }
    const vistaMensual = await obtenerVistaMensual(tx, query.anio, query.mes, query);
    return configuracion ? { ...vistaMensual, configuracion } : vistaMensual;
  });

  responder(res, vista);
};
