import type { Request, Response } from 'express';
import { prisma } from '../../db';
import { responder } from '../../utils/respuesta';
import { registrarAuditoria } from '../registros_auditoria/helper';
import { esquemaActualizarFormulario, esquemaId } from './zod';

export const actualizarFormulario = async (req: Request, res: Response) => {
  const { id } = esquemaId.parse(req.params);
  const body = esquemaActualizarFormulario.parse(req.body);
  const formulario = await prisma.$transaction(async (tx) => {
    const actualizado = await tx.formulario.update({
      where: { id },
      data: {
        ...(body.nombre !== undefined ? { nombre: body.nombre } : {}),
        ...(body.descripcion !== undefined ? { descripcion: body.descripcion?.trim() || null } : {}),
        ...(body.alcance !== undefined ? { alcance: body.alcance } : {}),
        ...(body.activo !== undefined ? { activo: body.activo } : {}),
      },
    });
    await registrarAuditoria({ usuarioId: req.autenticacion?.usuarioId, accion: 'ACTUALIZAR_FORMULARIO', tipoEntidad: 'Formulario', idEntidad: id, datosNuevos: actualizado }, tx);
    return actualizado;
  });
  responder(res, { formulario });
};
