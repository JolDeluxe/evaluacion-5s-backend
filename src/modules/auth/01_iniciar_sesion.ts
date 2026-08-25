import type { Request, Response } from 'express';
import { prisma } from '../../db';
import { normalizarNombreUsuario, verificarContrasena } from '../../utils/crypto';
import { responder } from '../../utils/respuesta';
import { esquemaIniciarSesion } from './zod';
import { crearSesion, usuarioSeguro } from './helper';

export const iniciarSesion = async (req: Request, res: Response) => {
  const body = esquemaIniciarSesion.parse(req.body);
  const identificador = normalizarNombreUsuario(body.nombreUsuario);
  const usuario = await prisma.usuario.findFirst({
    where: {
      activo: true,
      OR: [
        { nombreUsuario: identificador },
        { correo: identificador },
      ],
    },
  });

  if (!usuario || !(await verificarContrasena(body.contrasena, usuario.hashContrasena))) {
    res.status(401).json({ error: { codigo: 'CREDENCIALES_INVALIDAS', mensaje: 'Credenciales invalidas' } });
    return;
  }

  const usuarioActualizado = await prisma.$transaction(async (tx) => {
    await crearSesion(usuario.id, res, {
      agenteUsuario: req.get('user-agent') ?? undefined,
      direccionIp: req.ip,
    }, tx);
    return tx.usuario.update({
      where: { id: usuario.id },
      data: { ultimoInicioSesionEn: new Date() },
    });
  });

  responder(res, { usuario: usuarioSeguro(usuarioActualizado) });
};
