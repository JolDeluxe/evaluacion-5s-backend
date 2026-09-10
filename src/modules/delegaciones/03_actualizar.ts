import type { Request, Response } from 'express';
import { prisma } from '../../db';
import { conflicto, noAutenticado, noEncontrado, solicitudInvalida } from '../../utils/errores';
import { responder } from '../../utils/respuesta';
import { registrarAuditoria } from '../registros_auditoria/helper';
import { esquemaActualizarDelegacion, esquemaParamIdDelegacion } from './zod';

export const actualizarDelegacion = async (req: Request, res: Response) => {
  const adminId = req.autenticacion?.usuarioId;
  if (!adminId) throw noAutenticado();

  const { id } = esquemaParamIdDelegacion.parse(req.params);
  const body = esquemaActualizarDelegacion.parse(req.body);

  const delegacionActualizada = await prisma.$transaction(async (tx) => {
    const actual = await tx.delegacionCumplimiento.findUnique({
      where: { id },
      include: {
        ejecutor: { select: { nombre: true } },
        responsable: { select: { nombre: true } },
      },
    });

    if (!actual) throw noEncontrado('Delegación no encontrada');

    const nuevaDesde = body.vigenteDesde ?? actual.vigenteDesde;
    const nuevaHasta = body.vigenteHasta !== undefined ? body.vigenteHasta : actual.vigenteHasta;

    if (nuevaHasta && nuevaDesde.getTime() > nuevaHasta.getTime()) {
      throw solicitudInvalida('La fecha de fin no puede ser anterior a la fecha de inicio');
    }

    const nuevaActiva = body.activa !== undefined ? body.activa : actual.activa;

    if (nuevaActiva) {
      const duplicada = await tx.delegacionCumplimiento.findFirst({
        where: {
          id: { not: id },
          ejecutorId: actual.ejecutorId,
          responsableId: actual.responsableId,
          activa: true,
        },
      });

      if (duplicada) {
        throw conflicto('Ya existe otra delegación activa entre este auditor ejecutor y el responsable');
      }

      const cicloInverso = await tx.delegacionCumplimiento.findFirst({
        where: {
          id: { not: id },
          ejecutorId: actual.responsableId,
          responsableId: actual.ejecutorId,
          activa: true,
        },
      });

      if (cicloInverso) {
        throw conflicto('No se puede activar esta delegación: existe una delegación inversa activa');
      }
    }

    const actualizada = await tx.delegacionCumplimiento.update({
      where: { id },
      data: {
        ...(body.vigenteDesde ? { vigenteDesde: body.vigenteDesde } : {}),
        ...(body.vigenteHasta !== undefined ? { vigenteHasta: body.vigenteHasta } : {}),
        ...(body.activa !== undefined ? { activa: body.activa } : {}),
      },
      include: {
        ejecutor: {
          select: {
            id: true,
            nombre: true,
            nombreUsuario: true,
            correo: true,
            rol: true,
            activo: true,
          },
        },
        responsable: {
          select: {
            id: true,
            nombre: true,
            nombreUsuario: true,
            correo: true,
            rol: true,
            activo: true,
          },
        },
      },
    });

    await registrarAuditoria({
      usuarioId: adminId,
      accion: 'ACTUALIZAR_DELEGACION_CUMPLIMIENTO',
      tipoEntidad: 'DelegacionCumplimiento',
      idEntidad: actualizada.id,
      datosAnteriores: {
        vigenteDesde: actual.vigenteDesde,
        vigenteHasta: actual.vigenteHasta,
        activa: actual.activa,
      },
      datosNuevos: {
        vigenteDesde: actualizada.vigenteDesde,
        vigenteHasta: actualizada.vigenteHasta,
        activa: actualizada.activa,
      },
    }, tx);

    return actualizada;
  });

  responder(res, delegacionActualizada);
};
