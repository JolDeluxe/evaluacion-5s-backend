import type { Request, Response } from 'express';
import { normalizarCorreo, normalizarNombreUsuario } from '../../utils/crypto';
import { conflicto, solicitudInvalida } from '../../utils/errores';
import { responder } from '../../utils/respuesta';
import { transaccionSerializable } from '../../utils/transaccion';
import { registrarAuditoria } from '../registros_auditoria/helper';
import { assertNoQuitaUltimoSuperAdmin, assertPuedeGestionarRolUsuario, limpiarUsuario, seleccionarUsuarioSeguro } from './helper';
import { esquemaActualizarUsuario, esquemaId } from './zod';
import { puedeUsuarioAuditar } from '../asignaciones/servicio_reasignacion';
import { aplicarResolucionesAuditoriasUsuario } from './servicio_impacto_usuario';

export const actualizarUsuario = async (req: Request, res: Response) => {
  const { id } = esquemaId.parse(req.params);
  const body = esquemaActualizarUsuario.parse(req.body);
  const usuario = await transaccionSerializable(async (tx) => {
    const anterior = await tx.usuario.findUniqueOrThrow({ where: { id }, select: seleccionarUsuarioSeguro });
    await assertPuedeGestionarRolUsuario(req.autenticacion, { id, rol: anterior.rol, activo: anterior.activo }, tx, 'actualizar');
    if (body.rol) {
      await assertPuedeGestionarRolUsuario(req.autenticacion, { id, rol: body.rol, activo: anterior.activo }, tx, 'actualizar');
      await assertNoQuitaUltimoSuperAdmin(id, anterior.rol, body.rol, anterior.activo, tx);
    }
    const rolResultante = body.rol ?? anterior.rol;
    const esComodinResultante = body.esComodin !== undefined ? body.esComodin : anterior.esComodin;
    if (esComodinResultante && rolResultante !== 'ADMINISTRADOR') {
      throw solicitudInvalida('El atributo esComodin solo está permitido para usuarios con rol ADMINISTRADOR');
    }

    if (body.seEvalua === true) {
      const totalAreas = await tx.usuarioArea.count({ where: { usuarioId: id } });
      if (totalAreas === 0) {
        throw solicitudInvalida('Para activar seEvalua, el usuario debe tener al menos un área asignada en el sistema');
      }
    }

    const pierdeCapacidad = puedeUsuarioAuditar(anterior)
      && !puedeUsuarioAuditar({ activo: anterior.activo, rol: rolResultante });
    let impacto = { completadas: 0, vencidas: 0, reasignadas: 0, pendientes: 0 };
    if (pierdeCapacidad) {
      if (!body.resolucionesAuditorias) {
        throw conflicto('Revisa y resuelve el impacto sobre auditorías antes de cambiar el rol');
      }
      const resolucion = await aplicarResolucionesAuditoriasUsuario(
        tx,
        id,
        body.resolucionesAuditorias,
        req.autenticacion?.usuarioId ?? 1,
        'AUDITOR_SIN_ROL_EJECUTABLE',
      );
      impacto = {
        completadas: resolucion.impacto.historico.completadas,
        vencidas: resolucion.impacto.historico.vencidas,
        reasignadas: resolucion.reasignadas,
        pendientes: resolucion.pendientes,
      };
    }
    const actualizado = await tx.usuario.update({
      where: { id },
      data: {
        ...(body.nombreUsuario ? { nombreUsuario: normalizarNombreUsuario(body.nombreUsuario) } : {}),
        ...(body.correo !== undefined ? { correo: normalizarCorreo(body.correo) } : {}),
        ...(body.telefonoE164 !== undefined ? { telefonoE164: body.telefonoE164?.trim() || null } : {}),
        ...(body.nombre ? { nombre: body.nombre.trim() } : {}),
        ...(body.rol ? { rol: body.rol } : {}),
        ...(body.esComodin !== undefined ? { esComodin: body.esComodin } : {}),
        ...(body.puedeSerAsignadoAuditoria !== undefined ? { puedeSerAsignadoAuditoria: body.puedeSerAsignadoAuditoria } : {}),
        ...(body.seEvalua !== undefined ? { seEvalua: body.seEvalua } : {}),
      },
      select: seleccionarUsuarioSeguro,
    });
    const anteriorSeguro = limpiarUsuario(anterior);
    const actualizadoSeguro = limpiarUsuario(actualizado);
    await registrarAuditoria({
      usuarioId: req.autenticacion?.usuarioId,
      accion: anterior.rol !== actualizado.rol ? 'CAMBIAR_ROL_USUARIO' : 'ACTUALIZAR_USUARIO',
      tipoEntidad: 'Usuario',
      idEntidad: id,
      datosAnteriores: anteriorSeguro,
      datosNuevos: actualizadoSeguro,
    }, tx);
    return { usuario: actualizadoSeguro, impacto };
  });
  responder(res, usuario);
};
