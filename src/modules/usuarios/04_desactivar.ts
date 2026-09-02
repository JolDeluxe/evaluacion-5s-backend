import type { Request, Response } from 'express';
import { prisma } from '../../db';
import { responder } from '../../utils/respuesta';
import { conflicto } from '../../utils/errores';
import { registrarAuditoria } from '../registros_auditoria/helper';
import { liberarAsignacionesDeAuditorNoEjecutable, obtenerImpactoAuditorNoEjecutable, puedeUsuarioAuditar } from '../asignaciones/servicio_reasignacion';
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

    for (const relacion of anterior.areasUsuario.filter((ua) => ua.area.activo)) {
      const otrosResponsablesActivos = await tx.usuarioArea.count({
        where: { areaId: relacion.areaId, usuarioId: { not: id }, usuario: { activo: true } },
      });
      if (otrosResponsablesActivos === 0) {
        throw conflicto(`No puedes desactivar este usuario porque es el único responsable activo del área activa: "${relacion.area.nombre}". Asigna otro responsable primero.`);
      }
    }

    const actualizado = await tx.usuario.update({
      where: { id },
      data: { activo: false },
      select: seleccionarUsuarioSeguro,
    });

    const impacto = puedeUsuarioAuditar(anterior)
      ? await obtenerImpactoAuditorNoEjecutable(tx, id)
      : { completadas: 0, vencidas: 0, reasignables: 0 };
    if (puedeUsuarioAuditar(anterior)) {
      await liberarAsignacionesDeAuditorNoEjecutable(tx, id, 'AUDITOR_INACTIVO');
    }

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

    return { usuario: actualizado, impacto };
  });

  responder(res, usuario);
};
