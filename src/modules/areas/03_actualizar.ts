import type { Request, Response } from 'express';
import { prisma } from '../../db';
import { responder } from '../../utils/respuesta';
import { registrarAuditoria } from '../registros_auditoria/helper';
import { esquemaActualizarArea, esquemaId } from './zod';

export const actualizarArea = async (req: Request, res: Response) => {
  const { id } = esquemaId.parse(req.params);
  const body = esquemaActualizarArea.parse(req.body);
  const area = await prisma.$transaction(async (tx) => {
    const anterior = await tx.area.findUniqueOrThrow({ where: { id } });
    const actualizado = await tx.area.update({
      where: { id },
      data: {
        ...(body.codigo ? { codigo: body.codigo.trim().toUpperCase() } : {}),
        ...(body.nombre ? { nombre: body.nombre.trim() } : {}),
        ...(body.tipo ? { tipo: body.tipo } : {}),
        ...(body.areaPadreId !== undefined ? { areaPadreId: body.areaPadreId ?? null } : {}),
      },
    });
    await registrarAuditoria({ usuarioId: req.autenticacion?.usuarioId, accion: 'ACTUALIZAR_AREA', tipoEntidad: 'Area', idEntidad: id, datosAnteriores: anterior, datosNuevos: actualizado }, tx);
    return actualizado;
  });
  responder(res, { area });
};
