import type { Request, Response } from 'express';
import { prisma } from '../../db';
import { responder } from '../../utils/respuesta';
import { registrarAuditoria } from '../registros_auditoria/helper';
import { esquemaId } from './zod';

export const cambiarEstadoArea = (activo: boolean) => async (req: Request, res: Response) => {
  const { id } = esquemaId.parse(req.params);
  const area = await prisma.$transaction(async (tx) => {
    const anterior = await tx.area.findUniqueOrThrow({ where: { id } });
    const actualizado = await tx.area.update({ where: { id }, data: { activo } });
    await registrarAuditoria({ usuarioId: req.autenticacion?.usuarioId, accion: activo ? 'REACTIVAR_AREA' : 'DESACTIVAR_AREA', tipoEntidad: 'Area', idEntidad: id, datosAnteriores: anterior, datosNuevos: actualizado }, tx);
    return actualizado;
  });
  responder(res, { area });
};
