import type { Request, Response } from 'express';
import { EstadoAsignacionAuditoria } from '../../generated/prisma/enums';
import { responder } from '../../utils/respuesta';
import { transaccionSerializable } from '../../utils/transaccion';
import { registrarAuditoria } from '../registros_auditoria/helper';
import { crearNotificacionAsignacion } from '../notificaciones/helper';
import { esquemaId } from './zod';

export const publicarAsignacion = async (req: Request, res: Response) => {
  const { id } = esquemaId.parse(req.params);
  const asignacion = await transaccionSerializable(async (tx) => {
    const actualizada = await tx.asignacionAuditoria.update({
      where: { id },
      data: { estado: EstadoAsignacionAuditoria.PENDIENTE, asignadoEn: new Date() },
      include: { objetivoAuditoria: true, auditor: true },
    });
    await crearNotificacionAsignacion(actualizada, tx);
    await registrarAuditoria({ usuarioId: req.autenticacion?.usuarioId, accion: 'PUBLICAR_ASIGNACION', tipoEntidad: 'AsignacionAuditoria', idEntidad: id, datosNuevos: actualizada }, tx);
    return actualizada;
  });
  responder(res, { asignacion });
};
