import type { Response } from 'express';
import { env } from '../../config/env';
import { establecerCookieSesion, limpiarCookieSesion } from '../../config/cookies';
import { prisma, type PrismaTransaction } from '../../db';
import type { Usuario } from '../../generated/prisma/client';
import { generarTokenSeguro, hashSha256 } from '../../utils/crypto';

export const usuarioSeguro = (usuario: Usuario) => ({
  id: usuario.id,
  nombreUsuario: usuario.nombreUsuario,
  correo: usuario.correo,
  telefonoE164: usuario.telefonoE164,
  nombre: usuario.nombre,
  rol: usuario.rol,
  activo: usuario.activo,
  debeCambiarContrasena: usuario.debeCambiarContrasena,
  ultimoInicioSesionEn: usuario.ultimoInicioSesionEn,
  contrasenaCambiadaEn: usuario.contrasenaCambiadaEn,
  creadoEn: usuario.creadoEn,
  actualizadoEn: usuario.actualizadoEn,
});

export const crearSesion = async (
  usuarioId: number,
  res: Response,
  meta: { agenteUsuario?: string; direccionIp?: string },
  tx: PrismaTransaction | typeof prisma = prisma
) => {
  const token = generarTokenSeguro(32);
  const ahora = new Date();
  const expiraEn = new Date(ahora.getTime() + env.SESION_DIAS_INACTIVIDAD * 24 * 60 * 60 * 1000);

  const sesion = await tx.sesion.create({
    data: {
      usuarioId,
      hashToken: hashSha256(token),
      expiraEn,
      ultimoUsoEn: ahora,
      agenteUsuario: meta.agenteUsuario,
      direccionIp: meta.direccionIp,
    },
  });

  establecerCookieSesion(res, token);
  return sesion;
};

export const revocarSesionActual = async (sesionId: number, res: Response) => {
  await prisma.sesion.update({
    where: { id: sesionId },
    data: { revocadoEn: new Date() },
  });
  limpiarCookieSesion(res);
};
