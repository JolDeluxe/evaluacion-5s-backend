import type { Request, Response } from 'express';
import { env } from '../../config/env';
import { transportCorreo } from '../../config/correo';
import { prisma } from '../../db';
import { generarTokenSeguro, hashSha256, normalizarCorreo } from '../../utils/crypto';
import { responder } from '../../utils/respuesta';
import { esquemaSolicitarRestablecimiento } from './zod';

export const solicitarRestablecimiento = async (req: Request, res: Response) => {
  const body = esquemaSolicitarRestablecimiento.parse(req.body);
  const correo = normalizarCorreo(body.correo);

  const usuario = correo
    ? await prisma.usuario.findFirst({ where: { correo, activo: true } })
    : null;

  if (usuario) {
    const token = generarTokenSeguro(32);
    await prisma.tokenRestablecimientoContrasena.create({
      data: {
        usuarioId: usuario.id,
        hashToken: hashSha256(token),
        expiraEn: new Date(Date.now() + 60 * 60 * 1000),
      },
    });

    if (env.SMTP_ENABLED && transportCorreo && usuario.correo) {
      await transportCorreo.sendMail({
        to: usuario.correo,
        from: env.SMTP_FROM,
        subject: 'Restablecimiento de contrasena',
        text: `Usa este token para restablecer tu contrasena: ${token}`,
      });
    }
  }

  responder(res, { mensaje: 'Si el correo existe, recibiras instrucciones para restablecer la contrasena' });
};
