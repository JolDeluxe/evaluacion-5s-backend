import type { Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../../db';
import { solicitudInvalida } from '../../utils/errores';
import { responder } from '../../utils/respuesta';
import { registrarAuditoria } from '../registros_auditoria/helper';

const esquemaId = z.object({ id: z.coerce.number().int().positive() });

export const revocarSesionSistema = async (req: Request, res: Response) => {
  const { id } = esquemaId.parse(req.params);
  if (id === req.autenticacion?.sesionId) {
    throw solicitudInvalida('No puedes revocar la sesion actual desde este panel');
  }

  const sesion = await prisma.$transaction(async (tx) => {
    const actualizada = await tx.sesion.update({
      where: { id },
      data: { revocadoEn: new Date() },
      select: { id: true, usuarioId: true, revocadoEn: true },
    });

    await registrarAuditoria({
      usuarioId: req.autenticacion?.usuarioId,
      accion: 'REVOCAR_SESION_SISTEMA',
      tipoEntidad: 'Sesion',
      idEntidad: id,
      datosNuevos: actualizada,
    }, tx);

    return actualizada;
  });

  responder(res, { sesion });
};
