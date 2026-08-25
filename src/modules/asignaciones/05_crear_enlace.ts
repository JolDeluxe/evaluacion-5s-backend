import type { Request, Response } from 'express';
import { prisma } from '../../db';
import { generarTokenSeguro, hashSha256 } from '../../utils/crypto';
import { responderCreado } from '../../utils/respuesta';
import { registrarAuditoria } from '../registros_auditoria/helper';
import { esquemaCrearEnlace, esquemaId } from './zod';

export const crearEnlaceInvitado = async (req: Request, res: Response) => {
  const { id: asignacionAuditoriaId } = esquemaId.parse(req.params);
  const body = esquemaCrearEnlace.parse(req.body);
  const token = generarTokenSeguro(32);
  const enlace = await prisma.$transaction(async (tx) => {
    const creado = await tx.enlaceInvitado.create({
      data: {
        asignacionAuditoriaId,
        creadoPorId: req.autenticacion?.usuarioId ?? 1,
        hashToken: hashSha256(token),
        expiraEn: body.expiraEn,
      },
    });
    await registrarAuditoria({ usuarioId: req.autenticacion?.usuarioId, accion: 'CREAR_ENLACE_INVITADO', tipoEntidad: 'EnlaceInvitado', idEntidad: creado.id }, tx);
    return creado;
  });
  responderCreado(res, { enlace, token });
};
