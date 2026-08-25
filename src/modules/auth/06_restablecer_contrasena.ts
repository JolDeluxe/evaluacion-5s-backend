import type { Request, Response } from 'express';
import { prisma } from '../../db';
import { hashContrasena, hashSha256, validarContrasena } from '../../utils/crypto';
import { solicitudInvalida } from '../../utils/errores';
import { responder } from '../../utils/respuesta';
import { registrarAuditoria } from '../registros_auditoria/helper';
import { esquemaRestablecerContrasena } from './zod';

export const restablecerContrasena = async (req: Request, res: Response) => {
  const body = esquemaRestablecerContrasena.parse(req.body);
  const errorContrasena = validarContrasena(body.contrasena);
  if (errorContrasena) throw solicitudInvalida(errorContrasena);

  const hashToken = hashSha256(body.token);
  const ahora = new Date();
  const nuevoHash = await hashContrasena(body.contrasena);

  await prisma.$transaction(async (tx) => {
    const token = await tx.tokenRestablecimientoContrasena.findUnique({
      where: { hashToken },
      include: { usuario: true },
    });

    if (!token || token.usadoEn || token.expiraEn <= ahora || !token.usuario.activo) {
      throw solicitudInvalida('Token invalido o expirado');
    }

    await tx.usuario.update({
      where: { id: token.usuarioId },
      data: {
        hashContrasena: nuevoHash,
        debeCambiarContrasena: false,
        contrasenaCambiadaEn: ahora,
      },
    });
    await tx.tokenRestablecimientoContrasena.update({
      where: { id: token.id },
      data: { usadoEn: ahora },
    });
    await tx.sesion.updateMany({
      where: { usuarioId: token.usuarioId, revocadoEn: null },
      data: { revocadoEn: ahora },
    });
    await registrarAuditoria({
      usuarioId: token.usuarioId,
      accion: 'RESTABLECER_CONTRASENA',
      tipoEntidad: 'Usuario',
      idEntidad: token.usuarioId,
    }, tx);
  });

  responder(res, { mensaje: 'Contrasena actualizada' });
};
