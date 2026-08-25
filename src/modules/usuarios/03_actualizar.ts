import type { Request, Response } from 'express';
import { prisma } from '../../db';
import { normalizarCorreo, normalizarNombreUsuario } from '../../utils/crypto';
import { responder } from '../../utils/respuesta';
import { registrarAuditoria } from '../registros_auditoria/helper';
import { assertNoQuitaUltimoSuperAdmin, assertPuedeGestionarRolUsuario, seleccionarUsuarioSeguro } from './helper';
import { esquemaActualizarUsuario, esquemaId } from './zod';

export const actualizarUsuario = async (req: Request, res: Response) => {
  const { id } = esquemaId.parse(req.params);
  const body = esquemaActualizarUsuario.parse(req.body);
  const usuario = await prisma.$transaction(async (tx) => {
    const anterior = await tx.usuario.findUniqueOrThrow({ where: { id }, select: seleccionarUsuarioSeguro });
    await assertPuedeGestionarRolUsuario(req.autenticacion, { id, rol: anterior.rol, activo: anterior.activo }, tx, 'actualizar');
    if (body.rol) {
      await assertPuedeGestionarRolUsuario(req.autenticacion, { id, rol: body.rol, activo: anterior.activo }, tx, 'actualizar');
      await assertNoQuitaUltimoSuperAdmin(id, anterior.rol, body.rol, anterior.activo, tx);
    }
    const actualizado = await tx.usuario.update({
      where: { id },
      data: {
        ...(body.nombreUsuario ? { nombreUsuario: normalizarNombreUsuario(body.nombreUsuario) } : {}),
        ...(body.correo !== undefined ? { correo: normalizarCorreo(body.correo) } : {}),
        ...(body.telefonoE164 !== undefined ? { telefonoE164: body.telefonoE164?.trim() || null } : {}),
        ...(body.nombre ? { nombre: body.nombre.trim() } : {}),
        ...(body.rol ? { rol: body.rol } : {}),
      },
      select: seleccionarUsuarioSeguro,
    });
    await registrarAuditoria({
      usuarioId: req.autenticacion?.usuarioId,
      accion: anterior.rol !== actualizado.rol ? 'CAMBIAR_ROL_USUARIO' : 'ACTUALIZAR_USUARIO',
      tipoEntidad: 'Usuario',
      idEntidad: id,
      datosAnteriores: anterior,
      datosNuevos: actualizado,
    }, tx);
    return actualizado;
  });
  responder(res, { usuario });
};
