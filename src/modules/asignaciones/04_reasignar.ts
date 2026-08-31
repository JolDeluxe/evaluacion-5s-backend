import type { Request, Response } from 'express';
import { EstadoAsignacionAuditoria } from '../../generated/prisma/enums';
import { conflicto } from '../../utils/errores';
import { construirDetalleAdminPeriodo } from '../../utils/periodos';
import { responderCreado } from '../../utils/respuesta';
import { transaccionSerializable } from '../../utils/transaccion';
import { registrarAuditoria } from '../registros_auditoria/helper';
import { validarAuditorAsignable } from './helper';
import { esquemaId, esquemaReasignar } from './zod';

export const reasignar = async (req: Request, res: Response) => {
  const { id } = esquemaId.parse(req.params);
  const body = esquemaReasignar.parse(req.body);
  const nueva = await transaccionSerializable(async (tx) => {
    const anterior = await tx.asignacionAuditoria.findUniqueOrThrow({
      where: { id },
      include: {
        objetivoAuditoria: {
          include: {
            envioResultado: true,
            enviosAuditoria: true,
          },
        },
      },
    });
    const detalle = construirDetalleAdminPeriodo(anterior.objetivoAuditoria, new Date(), anterior.reabiertaHasta);
    if (
      anterior.estado === EstadoAsignacionAuditoria.COMPLETADA
      || anterior.estado === EstadoAsignacionAuditoria.VENCIDA
      || detalle.realizada
      || detalle.situacion === 'NO_REALIZADA'
    ) {
      throw conflicto('La auditoria realizada o vencida no puede reasignarse desde este flujo');
    }
    await validarAuditorAsignable(tx, body.auditorId, anterior.objetivoAuditoriaId);
    await tx.asignacionAuditoria.update({
      where: { id },
      data: {
        estado: EstadoAsignacionAuditoria.CANCELADA,
        canceladoEn: new Date(),
        motivoCancelacion: body.motivoCancelacion ?? 'Reasignacion',
      },
    });
    const creada = await tx.asignacionAuditoria.create({
      data: {
        objetivoAuditoriaId: anterior.objetivoAuditoriaId,
        auditorId: body.auditorId,
        asignadoPorId: req.autenticacion?.usuarioId ?? anterior.asignadoPorId,
        estado: EstadoAsignacionAuditoria.PENDIENTE,
        asignadoEn: new Date(),
        venceEn: body.venceEn ?? anterior.venceEn,
      },
    });
    await registrarAuditoria({ usuarioId: req.autenticacion?.usuarioId, accion: 'REASIGNAR_AUDITORIA', tipoEntidad: 'AsignacionAuditoria', idEntidad: creada.id, datosAnteriores: anterior, datosNuevos: creada }, tx);
    return creada;
  });
  responderCreado(res, { asignacion: nueva });
};
