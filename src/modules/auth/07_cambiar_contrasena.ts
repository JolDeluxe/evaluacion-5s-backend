import type { Request, Response } from 'express';
import { limpiarCookieSesion } from '../../config/cookies';
import { prisma } from '../../db';
import { hashContrasena, validarContrasena, verificarContrasena } from '../../utils/crypto';
import { noAutenticado, solicitudInvalida } from '../../utils/errores';
import { responder } from '../../utils/respuesta';
import { registrarAuditoria } from '../registros_auditoria/helper';
import { esquemaCambiarContrasena } from './zod';

export const cambiarContrasena = async (req: Request, res: Response) => {
  if (!req.autenticacion) throw noAutenticado();
  const body = esquemaCambiarContrasena.parse(req.body);
  const errorContrasena = validarContrasena(body.contrasenaNueva);
  if (errorContrasena) throw solicitudInvalida(errorContrasena);

  const usuario = await prisma.usuario.findUniqueOrThrow({ where: { id: req.autenticacion.usuarioId } });
  if (!(await verificarContrasena(body.contrasenaActual, usuario.hashContrasena))) {
    throw solicitudInvalida('Contrasena actual incorrecta');
  }

  const ahora = new Date();
  const nuevoHash = await hashContrasena(body.contrasenaNueva);
  await prisma.$transaction(async (tx) => {
    await tx.usuario.update({
      where: { id: usuario.id },
      data: {
        hashContrasena: nuevoHash,
        debeCambiarContrasena: false,
        contrasenaCambiadaEn: ahora,
      },
    });
    await tx.sesion.updateMany({
      where: { usuarioId: usuario.id, id: { not: req.autenticacion?.sesionId }, revocadoEn: null },
      data: { revocadoEn: ahora },
    });
    await registrarAuditoria({
      usuarioId: usuario.id,
      accion: 'CAMBIAR_CONTRASENA',
      tipoEntidad: 'Usuario',
      idEntidad: usuario.id,
      direccionIp: req.ip,
      agenteUsuario: req.get('user-agent') ?? null,
    }, tx);
  });

  limpiarCookieSesion(res);
  responder(res, { mensaje: 'Contrasena actualizada. Inicia sesion nuevamente.' });
};
