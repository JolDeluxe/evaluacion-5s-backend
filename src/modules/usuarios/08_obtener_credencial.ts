import type { Request, Response } from 'express';
import { prisma } from '../../db';
import { desencriptarCredencial } from '../../utils/cifrado-credencial';
import { noAutenticado, prohibido } from '../../utils/errores';
import { responder } from '../../utils/respuesta';
import { registrarAuditoria } from '../registros_auditoria/helper';
import { esquemaId } from './zod';
import { RolUsuario } from '../../generated/prisma/enums';
import { esSuperAdmin } from '../../utils/permisos';

export const obtenerCredencialUsuario = async (req: Request, res: Response) => {
  if (!req.autenticacion) throw noAutenticado();
  const { id } = esquemaId.parse(req.params);

  const usuario = await prisma.usuario.findUniqueOrThrow({
    where: { id },
    select: {
      id: true,
      nombreUsuario: true,
      rol: true,
      credencialCifrada: true,
    },
  });

  if (usuario.rol === RolUsuario.SUPER_ADMIN && !esSuperAdmin(req.autenticacion.rol)) {
    throw prohibido('Solo SUPER_ADMIN puede visualizar la contraseña de usuarios SUPER_ADMIN');
  }

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
    usuarioId: req.autenticacion.usuarioId,
    accion: 'CONTRASENA_VISUALIZADA_USUARIO',
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
