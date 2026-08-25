import type { Request, Response } from 'express';
import { prisma } from '../../db';
import { noAutenticado } from '../../utils/errores';
import { responder } from '../../utils/respuesta';
import { usuarioSeguro } from './helper';

export const obtenerSesion = async (req: Request, res: Response) => {
  if (!req.autenticacion) throw noAutenticado();
  const usuario = await prisma.usuario.findUniqueOrThrow({ where: { id: req.autenticacion.usuarioId } });
  responder(res, { usuario: usuarioSeguro(usuario) });
};
