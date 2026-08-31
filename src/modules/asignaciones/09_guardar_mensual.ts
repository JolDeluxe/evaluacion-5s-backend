import type { Request, Response } from 'express';
import { responder } from '../../utils/respuesta';
import { transaccionSerializable } from '../../utils/transaccion';
import { asegurarProgramacionMensual, guardarAsignacionMensual, obtenerVistaMensual } from './programacion_mensual';
import { esquemaAreaId, esquemaGuardarAsignacionMensual } from './zod';

export const guardarAsignacionMensualArea = async (req: Request, res: Response) => {
  const { areaId } = esquemaAreaId.parse(req.params);
  const body = esquemaGuardarAsignacionMensual.parse(req.body);
  const usuarioId = req.autenticacion?.usuarioId ?? 1;

  const resultado = await transaccionSerializable(async (tx) => {
    await asegurarProgramacionMensual(tx, body.anio, body.mes, usuarioId);
    const guardado = await guardarAsignacionMensual(tx, {
      areaId,
      anio: body.anio,
      mes: body.mes,
      auditorMensualId: body.auditorMensualId,
      asignadoPorId: usuarioId,
    });
    const vista = await obtenerVistaMensual(tx, body.anio, body.mes);
    return { guardado, vista };
  });

  responder(res, resultado);
};
