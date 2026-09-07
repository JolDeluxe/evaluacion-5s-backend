import type { Request, Response } from 'express';
import { prisma } from '../../db';
import { generarTokenSeguro, normalizarCorreo, normalizarNombreUsuario, validarContrasena } from '../../utils/crypto';
import { solicitudInvalida } from '../../utils/errores';
import { responderCreado } from '../../utils/respuesta';
import { registrarAuditoria } from '../registros_auditoria/helper';
import { assertPuedeGestionarRolUsuario, limpiarUsuario, seleccionarUsuarioSeguro } from './helper';
import { esquemaCrearUsuario } from './zod';

import { prepararCamposContrasena } from '../../utils/cifrado-credencial';

export const crearUsuario = async (req: Request, res: Response) => {
  const body = esquemaCrearUsuario.parse(req.body);
  const contrasenaTemporal = body.contrasena ?? generarTokenSeguro(12);
  const errorContrasena = validarContrasena(contrasenaTemporal);
  if (errorContrasena) throw solicitudInvalida(errorContrasena);

  const camposContrasena = await prepararCamposContrasena(contrasenaTemporal);

  const usuario = await prisma.$transaction(async (tx) => {
    await assertPuedeGestionarRolUsuario(req.autenticacion, { rol: body.rol }, tx, 'crear');
    const creado = await tx.usuario.create({
      data: {
        nombreUsuario: normalizarNombreUsuario(body.nombreUsuario),
        correo: normalizarCorreo(body.correo),
        telefonoE164: body.telefonoE164?.trim() || null,
        nombre: body.nombre.trim(),
        rol: body.rol,
        ...camposContrasena,
        debeCambiarContrasena: true,
      },
      select: seleccionarUsuarioSeguro,
    });
    const usuarioSeguro = limpiarUsuario(creado);
    await registrarAuditoria({
      usuarioId: req.autenticacion?.usuarioId,
      accion: body.rol === 'SUPER_ADMIN' ? 'CREAR_SUPER_ADMIN' : 'CREAR_USUARIO',
      tipoEntidad: 'Usuario',
      idEntidad: creado.id,
      datosNuevos: usuarioSeguro,
    }, tx);
    return usuarioSeguro;
  });

  responderCreado(res, { usuario, contrasenaTemporal: body.contrasena ? undefined : contrasenaTemporal });
};
