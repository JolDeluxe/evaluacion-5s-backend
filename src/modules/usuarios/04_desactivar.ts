import type { Request, Response } from 'express';
import { prisma } from '../../db';
import { responder } from '../../utils/respuesta';
import { conflicto } from '../../utils/errores';
import { registrarAuditoria } from '../registros_auditoria/helper';
import { assertPuedeGestionarRolUsuario, seleccionarUsuarioSeguro } from './helper';
import { esquemaId } from './zod';

export const desactivarUsuario = async (req: Request, res: Response) => {
  const { id } = esquemaId.parse(req.params);

  const usuario = await prisma.$transaction(async (tx) => {
    const anterior = await tx.usuario.findUniqueOrThrow({
      where: { id },
      select: {
        ...seleccionarUsuarioSeguro,
        areasUsuario: {
          select: {
            areaId: true,
            area: { select: { nombre: true, activo: true } },
          },
        },
      },
    });

    await assertPuedeGestionarRolUsuario(
      req.autenticacion,
      { id, rol: anterior.rol, activo: anterior.activo },
      tx,
      'desactivar',
    );

    // 1. Validar que no tenga asignaciones de auditoría activas (PENDIENTES o EN_PROCESO)
    const asignacionesActivas = await tx.asignacionAuditoria.count({
      where: {
        auditorId: id,
        estado: { in: ['PENDIENTE', 'EN_PROCESO'] },
      },
    });

    if (asignacionesActivas > 0) {
      throw conflicto(
        `No se puede desactivar el usuario porque tiene ${asignacionesActivas} asignaciones de auditoría activas (pendientes o en proceso).`,
      );
    }

    // 2. Validar que no sea el único responsable de algún área activa
    const areasActivasBajoResponsabilidad = anterior.areasUsuario.filter(
      (ua) => ua.area.activo,
    );

    for (const relacion of areasActivasBajoResponsabilidad) {
      // Contar cuántos otros responsables activos tiene esta área
      const otrosResponsablesActivos = await tx.usuarioArea.count({
        where: {
          areaId: relacion.areaId,
          usuarioId: { not: id },
          usuario: { activo: true },
        },
      });

      if (otrosResponsablesActivos === 0) {
        throw conflicto(
          `No puedes desactivar este usuario porque es el único responsable activo del área activa: "${relacion.area.nombre}". Asigna otro responsable primero.`,
        );
      }
    }

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
        usuarioId: req.autenticacion?.usuarioId,
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

    return actualizado;
  });

  responder(res, { usuario });
};
