import type { Request, Response } from 'express';
import { prisma } from '../../db';
import { noAutenticado, noEncontrado } from '../../utils/errores';
import { responder } from '../../utils/respuesta';
import { registrarAuditoria } from '../registros_auditoria/helper';
import { esquemaParamIdDelegacion } from './zod';

export const eliminarDelegacion = async (req: Request, res: Response) => {
  const adminId = req.autenticacion?.usuarioId;
  if (!adminId) throw noAutenticado();

  const { id } = esquemaParamIdDelegacion.parse(req.params);

  await prisma.$transaction(async (tx) => {
    const actual = await tx.delegacionCumplimiento.findUnique({
      where: { id },
      include: {
        ejecutor: { select: { nombre: true } },
        responsable: { select: { nombre: true } },
      },
    });

    if (!actual) throw noEncontrado('Delegación no encontrada');

    await tx.delegacionCumplimiento.delete({
      where: { id },
    });

    await registrarAuditoria({
      usuarioId: adminId,
      accion: 'ELIMINAR_DELEGACION_CUMPLIMIENTO',
      tipoEntidad: 'DelegacionCumplimiento',
      idEntidad: actual.id,
      datosAnteriores: {
        id: actual.id,
        ejecutorId: actual.ejecutorId,
        ejecutorNombre: actual.ejecutor.nombre,
        responsableId: actual.responsableId,
        responsableNombre: actual.responsable.nombre,
        vigenteDesde: actual.vigenteDesde,
        vigenteHasta: actual.vigenteHasta,
        activa: actual.activa,
      },
    }, tx);
  });

  responder(res, { mensaje: 'Delegación eliminada exitosamente' });
};
