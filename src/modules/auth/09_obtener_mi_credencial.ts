import type { Request, Response } from 'express';
import { prisma } from '../../db';
import { desencriptarCredencial } from '../../utils/cifrado-credencial';
import { noAutenticado } from '../../utils/errores';
import { responder } from '../../utils/respuesta';
import { registrarAuditoria } from '../registros_auditoria/helper';

export const obtenerMiCredencial = async (req: Request, res: Response) => {
  if (!req.autenticacion) throw noAutenticado();

  const usuario = await prisma.usuario.findUniqueOrThrow({
    where: { id: req.autenticacion.usuarioId },
    select: {
      id: true,
      credencialCifrada: true,
    },
  });

  res.setHeader('Cache-Control', 'private, no-store, no-cache, must-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('Vary', 'Cookie');

  if (!usuario.credencialCifrada) {
    return responder(res, {
      tieneCredencial: false,
      credencial: null,
      mensaje: 'La visualización estará disponible después de establecer una nueva contraseña.',
    });
  }

  const credencialTextoPlano = desencriptarCredencial(usuario.credencialCifrada);

  await registrarAuditoria({
    usuarioId: usuario.id,
    accion: 'MI_CONTRASENA_VISUALIZADA',
    tipoEntidad: 'Usuario',
    idEntidad: usuario.id,
    direccionIp: req.ip,
    agenteUsuario: req.get('user-agent') ?? null,
  });

  return responder(res, {
    tieneCredencial: true,
    credencial: credencialTextoPlano,
  });
};
