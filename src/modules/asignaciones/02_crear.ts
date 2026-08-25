import type { Request, Response } from 'express';
import { EstadoAsignacionAuditoria } from '../../generated/prisma/enums';
import { responderCreado } from '../../utils/respuesta';
import { transaccionSerializable } from '../../utils/transaccion';
import { registrarAuditoria } from '../registros_auditoria/helper';
import { validarAuditorAsignable } from './helper';
import { esquemaCrearAsignacion } from './zod';

export const crearAsignacion = async (req: Request, res: Response) => {
  const body = esquemaCrearAsignacion.parse(req.body);
  const asignacion = await transaccionSerializable(async (tx) => {
    await validarAuditorAsignable(tx, body.auditorId, body.objetivoAuditoriaId);
    const creada = await tx.asignacionAuditoria.create({
      data: {
        objetivoAuditoriaId: body.objetivoAuditoriaId,
        auditorId: body.auditorId,
        asignadoPorId: req.autenticacion?.usuarioId ?? 1,
        estado: EstadoAsignacionAuditoria.PENDIENTE,
        asignadoEn: new Date(),
        venceEn: body.venceEn,
      },
      include: { objetivoAuditoria: true, auditor: true },
    });
    await registrarAuditoria({ usuarioId: req.autenticacion?.usuarioId, accion: 'CREAR_ASIGNACION', tipoEntidad: 'AsignacionAuditoria', idEntidad: creada.id, datosNuevos: creada }, tx);
    return creada;
  });
  responderCreado(res, { asignacion });
};
