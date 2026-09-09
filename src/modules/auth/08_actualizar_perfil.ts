import type { Request, Response } from 'express';
import { prisma } from '../../db';
import { normalizarCorreo, normalizarNombreUsuario } from '../../utils/crypto';
import { conflicto, noAutenticado } from '../../utils/errores';
import { responder } from '../../utils/respuesta';
import { registrarAuditoria } from '../registros_auditoria/helper';
import { usuarioSeguro } from './helper';
import { esquemaActualizarPerfil } from './zod';

export const actualizarPerfil = async (req: Request, res: Response) => {
  if (!req.autenticacion) throw noAutenticado();
  const usuarioId = req.autenticacion.usuarioId;
  const body = esquemaActualizarPerfil.parse(req.body);

  const usuarioActual = await prisma.usuario.findUniqueOrThrow({
    where: { id: usuarioId },
  });

  const correoNormalizado = normalizarCorreo(body.correo);
  const nombreUsuarioNormalizado = body.nombreUsuario
    ? normalizarNombreUsuario(body.nombreUsuario)
    : usuarioActual.nombreUsuario;
  const telefonoLimpio = body.telefonoE164?.trim() || null;
  const nombreLimpio = body.nombre.trim();

  if (correoNormalizado && correoNormalizado !== usuarioActual.correo) {
    const existe = await prisma.usuario.findFirst({
      where: {
        correo: correoNormalizado,
        id: { not: usuarioId },
      },
    });
    if (existe) {
      throw conflicto('El correo electrónico ya está registrado por otro usuario');
    }
  }

  if (nombreUsuarioNormalizado !== usuarioActual.nombreUsuario) {
    const existe = await prisma.usuario.findFirst({
      where: {
        nombreUsuario: nombreUsuarioNormalizado,
        id: { not: usuarioId },
      },
    });
    if (existe) {
      throw conflicto('El nombre de usuario ya está registrado por otro usuario');
    }
  }

  const usuarioActualizado = await prisma.$transaction(async (tx) => {
    const actualizado = await tx.usuario.update({
      where: { id: usuarioId },
      data: {
        nombreUsuario: nombreUsuarioNormalizado,
        nombre: nombreLimpio,
        correo: correoNormalizado,
        telefonoE164: telefonoLimpio,
      },
    });

    await registrarAuditoria({
      usuarioId,
      accion: 'ACTUALIZAR_PERFIL',
      tipoEntidad: 'Usuario',
      idEntidad: usuarioId,
      datosAnteriores: usuarioSeguro(usuarioActual),
      datosNuevos: usuarioSeguro(actualizado),
      direccionIp: req.ip,
      agenteUsuario: req.get('user-agent') ?? null,
    }, tx);

    return actualizado;
  });

  responder(res, {
    usuario: usuarioSeguro(usuarioActualizado),
    mensaje: 'Perfil actualizado correctamente',
  });
};
