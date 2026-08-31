import type { Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../../db';
import { responderSinContenido } from '../../utils/respuesta';
import { registrarAuditoria } from '../registros_auditoria/helper';
import { esquemaId } from './zod';

const esquemaQueryUsuario = z.object({
  usuarioId: z.coerce.number().int().positive(),
});

export const eliminarUsuarioArea = async (req: Request, res: Response) => {
  const { id: areaId } = esquemaId.parse(req.params);
  const { usuarioId } = esquemaQueryUsuario.parse(req.query);

  await prisma.$transaction(async (tx) => {
    const relacion = await tx.usuarioArea.findUnique({
      where: { usuarioId_areaId: { usuarioId, areaId } },
    });
    if (!relacion) return;

    await tx.usuarioArea.delete({
      where: { id: relacion.id },
    });

    await registrarAuditoria({
      usuarioId: req.autenticacion?.usuarioId,
      accion: 'ELIMINAR_USUARIO_AREA',
      tipoEntidad: 'UsuarioArea',
      idEntidad: relacion.id,
      datosAnteriores: relacion,
    }, tx);
  });

  responderSinContenido(res);
};
