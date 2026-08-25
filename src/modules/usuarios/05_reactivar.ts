import type { Request, Response } from 'express';
import { prisma } from '../../db';
import { responder } from '../../utils/respuesta';
import { registrarAuditoria } from '../registros_auditoria/helper';
import { assertPuedeGestionarRolUsuario, seleccionarUsuarioSeguro } from './helper';
import { esquemaId } from './zod';

export const reactivarUsuario = async (req: Request, res: Response) => {
  const { id } = esquemaId.parse(req.params);
  const usuario = await prisma.$transaction(async (tx) => {
    const anterior = await tx.usuario.findUniqueOrThrow({ where: { id }, select: seleccionarUsuarioSeguro });
    await assertPuedeGestionarRolUsuario(req.autenticacion, { id, rol: anterior.rol, activo: anterior.activo }, tx, 'reactivar');
    const actualizado = await tx.usuario.update({ where: { id }, data: { activo: true }, select: seleccionarUsuarioSeguro });
    await registrarAuditoria({ usuarioId: req.autenticacion?.usuarioId, accion: 'REACTIVAR_USUARIO', tipoEntidad: 'Usuario', idEntidad: id, datosAnteriores: anterior, datosNuevos: actualizado }, tx);
    return actualizado;
  });
  responder(res, { usuario });
};
