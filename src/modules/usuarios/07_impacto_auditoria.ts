import type { Request, Response } from 'express';
import { responder } from '../../utils/respuesta';
import { transaccionSerializable } from '../../utils/transaccion';
import { esquemaId } from './zod';
import { obtenerImpactoAuditorNoEjecutable } from '../asignaciones/servicio_reasignacion';

export const obtenerImpactoAuditoriaUsuario = async (req: Request, res: Response) => {
  const { id } = esquemaId.parse(req.params);
  const impacto = await transaccionSerializable((tx) => obtenerImpactoAuditorNoEjecutable(tx, id));
  responder(res, impacto);
};
