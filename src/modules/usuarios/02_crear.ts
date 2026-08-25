import type { Request, Response } from 'express';
import { prisma } from '../../db';
import { generarTokenSeguro, hashContrasena, normalizarCorreo, normalizarNombreUsuario, validarContrasena } from '../../utils/crypto';
import { solicitudInvalida } from '../../utils/errores';
import { responderCreado } from '../../utils/respuesta';
import { registrarAuditoria } from '../registros_auditoria/helper';
import { assertPuedeGestionarRolUsuario, seleccionarUsuarioSeguro } from './helper';
import { esquemaCrearUsuario } from './zod';

export const crearUsuario = async (req: Request, res: Response) => {
  const body = esquemaCrearUsuario.parse(req.body);
  const contrasenaTemporal = body.contrasena ?? generarTokenSeguro(12);
  const errorContrasena = validarContrasena(contrasenaTemporal);
  if (errorContrasena) throw solicitudInvalida(errorContrasena);

  const usuario = await prisma.$transaction(async (tx) => {
    await assertPuedeGestionarRolUsuario(req.autenticacion, { rol: body.rol }, tx, 'crear');
    const creado = await tx.usuario.create({
      data: {
        nombreUsuario: normalizarNombreUsuario(body.nombreUsuario),
        correo: normalizarCorreo(body.correo),
        telefonoE164: body.telefonoE164?.trim() || null,
        nombre: body.nombre.trim(),
        rol: body.rol,
        hashContrasena: await hashContrasena(contrasenaTemporal),
        debeCambiarContrasena: true,
      },
      select: seleccionarUsuarioSeguro,
    });
    await registrarAuditoria({
      usuarioId: req.autenticacion?.usuarioId,
      accion: body.rol === 'SUPER_ADMIN' ? 'CREAR_SUPER_ADMIN' : 'CREAR_USUARIO',
      tipoEntidad: 'Usuario',
      idEntidad: creado.id,
      datosNuevos: creado,
    }, tx);
    return creado;
  });

  responderCreado(res, { usuario, contrasenaTemporal: body.contrasena ? undefined : contrasenaTemporal });
};
