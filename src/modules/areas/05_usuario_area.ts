import type { Request, Response } from 'express';
import { prisma } from '../../db';
import { responder } from '../../utils/respuesta';
import { registrarAuditoria } from '../registros_auditoria/helper';
import { esquemaId, esquemaUsuarioArea } from './zod';

export const guardarUsuarioArea = async (req: Request, res: Response) => {
  const { id: areaId } = esquemaId.parse(req.params);
  const body = esquemaUsuarioArea.parse(req.body);
  const relacion = await prisma.$transaction(async (tx) => {
    const guardada = await tx.usuarioArea.upsert({
      where: { usuarioId_areaId: { usuarioId: body.usuarioId, areaId } },
      update: {
        esResponsable: body.esResponsable,
      },
      create: { ...body, areaId },
      include: { usuario: { select: { id: true, nombre: true, nombreUsuario: true, rol: true } }, area: true },
    });
    await registrarAuditoria({ usuarioId: req.autenticacion?.usuarioId, accion: 'GUARDAR_USUARIO_AREA', tipoEntidad: 'UsuarioArea', idEntidad: guardada.id, datosNuevos: guardada }, tx);
    return guardada;
  });
  responder(res, { relacion });
};
