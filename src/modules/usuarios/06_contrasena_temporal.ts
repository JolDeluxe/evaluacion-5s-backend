import type { Request, Response } from 'express';
import { prisma } from '../../db';
import { validarContrasena } from '../../utils/crypto';
import { solicitudInvalida } from '../../utils/errores';
import { responder } from '../../utils/respuesta';
import { registrarAuditoria } from '../registros_auditoria/helper';
import { esquemaContrasenaTemporal, esquemaId } from './zod';
import { assertPuedeGestionarRolUsuario, seleccionarUsuarioSeguro } from './helper';

import { prepararCamposContrasena } from '../../utils/cifrado-credencial';

export const establecerContrasenaTemporal = async (req: Request, res: Response) => {
  const { id } = esquemaId.parse(req.params);
  const body = esquemaContrasenaTemporal.parse(req.body);
  const errorContrasena = validarContrasena(body.contrasena);
  if (errorContrasena) throw solicitudInvalida(errorContrasena);

  const camposContrasena = await prepararCamposContrasena(body.contrasena);

  await prisma.$transaction(async (tx) => {
    const anterior = await tx.usuario.findUniqueOrThrow({ where: { id }, select: seleccionarUsuarioSeguro });
    await assertPuedeGestionarRolUsuario(req.autenticacion, { id, rol: anterior.rol, activo: anterior.activo }, tx, 'contrasena');
    await tx.usuario.update({
      where: { id },
      data: {
        ...camposContrasena,
        debeCambiarContrasena: body.debeCambiarContrasena,
        contrasenaCambiadaEn: new Date(),
      },
    });
    await tx.sesion.updateMany({ where: { usuarioId: id, revocadoEn: null }, data: { revocadoEn: new Date() } });
    await registrarAuditoria({ usuarioId: req.autenticacion?.usuarioId, accion: 'CONTRASENA_TEMPORAL_USUARIO', tipoEntidad: 'Usuario', idEntidad: id }, tx);
  });

  responder(res, {
    mensaje: 'Contrasena actualizada',
    tieneCredencialCifrada: true,
  });
};
