import type { NextFunction, Request, Response } from 'express';
import { env } from '../config/env';
import { establecerCookieSesion, limpiarCookieSesion } from '../config/cookies';
import { prisma } from '../db';
import { hashSha256 } from '../utils/crypto';
import { noAutenticado } from '../utils/errores';

const horasAMs = (horas: number) => horas * 60 * 60 * 1000;

const leerSesion = async (req: Request, res: Response) => {
  const token = req.signedCookies?.[env.SESION_NOMBRE_COOKIE] ?? req.cookies?.[env.SESION_NOMBRE_COOKIE];
  if (!token || typeof token !== 'string') return null;

  const sesion = await prisma.sesion.findUnique({
    where: { hashToken: hashSha256(token) },
    include: { usuario: true },
  });

  const ahora = new Date();
  if (!sesion || sesion.revocadoEn || sesion.expiraEn <= ahora || !sesion.usuario.activo) {
    limpiarCookieSesion(res);
    return null;
  }

  req.autenticacion = {
    usuarioId: sesion.usuarioId,
    sesionId: sesion.id,
    rol: sesion.usuario.rol,
  };

  const ultimoUso = sesion.ultimoUsoEn ?? sesion.creadoEn;
  if (ahora.getTime() - ultimoUso.getTime() >= horasAMs(env.SESION_RENOVAR_CADA_HORAS)) {
    const expiraEn = new Date(ahora.getTime() + env.SESION_DIAS_INACTIVIDAD * 24 * 60 * 60 * 1000);
    await prisma.sesion.update({
      where: { id: sesion.id },
      data: { ultimoUsoEn: ahora, expiraEn },
    });
    establecerCookieSesion(res, token);
  }

  return sesion;
};

export const autenticar = async (req: Request, res: Response, next: NextFunction) => {
  const sesion = await leerSesion(req, res);
  if (!sesion) throw noAutenticado();

  next();
};

export const autenticarOpcional = async (req: Request, res: Response, next: NextFunction) => {
  await leerSesion(req, res);
  next();
};
