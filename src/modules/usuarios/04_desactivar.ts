import type { Request, Response } from 'express';
import { responder } from '../../utils/respuesta';
import { transaccionSerializable } from '../../utils/transaccion';
import { registrarAuditoria } from '../registros_auditoria/helper';
import { assertPuedeGestionarRolUsuario, seleccionarUsuarioSeguro } from './helper';
import {
  aplicarResolucionesAuditoriasUsuario,
  aplicarResolucionesResponsabilidadUsuario,
  validarCruceResponsablesAuditores,
} from './servicio_impacto_usuario';
import { esquemaId, esquemaResolverBajaUsuario } from './zod';

export const desactivarUsuario = async (req: Request, res: Response) => {
  const { id } = esquemaId.parse(req.params);
  const decisiones = esquemaResolverBajaUsuario.parse(req.body);
  const actorId = req.autenticacion?.usuarioId ?? 1;

  const usuario = await transaccionSerializable(async (tx) => {
    const anterior = await tx.usuario.findUniqueOrThrow({
      where: { id },
      select: seleccionarUsuarioSeguro,
    });

    await assertPuedeGestionarRolUsuario(
      req.autenticacion,
      { id, rol: anterior.rol, activo: anterior.activo },
      tx,
      'desactivar',
    );

    validarCruceResponsablesAuditores(decisiones.responsabilidades, decisiones.auditorias);
    const auditorias = await aplicarResolucionesAuditoriasUsuario(
      tx,
      id,
      decisiones,
      actorId,
      'AUDITOR_INACTIVO',
    );
    const responsabilidades = await aplicarResolucionesResponsabilidadUsuario(
      tx,
      id,
      decisiones.responsabilidades,
      auditorias.impacto,
      actorId,
    );

    const actualizado = await tx.usuario.update({
      where: { id },
      data: { activo: false },
      select: seleccionarUsuarioSeguro,
    });

    await tx.sesion.updateMany({
      where: { usuarioId: id, revocadoEn: null },
      data: { revocadoEn: new Date() },
    });

    await registrarAuditoria(
      {
        usuarioId: actorId,
        accion: 'DESACTIVAR_USUARIO',
        tipoEntidad: 'Usuario',
        idEntidad: id,
        datosAnteriores: {
          id: anterior.id,
          nombreUsuario: anterior.nombreUsuario,
          correo: anterior.correo,
          telefonoE164: anterior.telefonoE164,
          nombre: anterior.nombre,
          rol: anterior.rol,
          activo: anterior.activo,
          debeCambiarContrasena: anterior.debeCambiarContrasena,
        },
        datosNuevos: actualizado,
      },
      tx,
    );

    return {
      usuario: actualizado,
      impacto: {
        completadas: auditorias.impacto.historico.completadas,
        vencidas: auditorias.impacto.historico.vencidas,
        reasignadas: auditorias.reasignadas,
        pendientes: auditorias.pendientes,
        responsabilidades,
      },
    };
  });

  responder(res, usuario);
};
