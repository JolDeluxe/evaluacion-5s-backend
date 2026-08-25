import type { Request, Response } from 'express';
import { z } from 'zod';
import { EstadoEntregaNotificacion } from '../../generated/prisma/enums';
import { prisma } from '../../db';
import { solicitudInvalida } from '../../utils/errores';
import { responder } from '../../utils/respuesta';
import { registrarAuditoria } from '../registros_auditoria/helper';

const esquemaId = z.object({ id: z.coerce.number().int().positive() });

export const reintentarEntregaNotificacionSistema = async (req: Request, res: Response) => {
  const { id } = esquemaId.parse(req.params);

  const entrega = await prisma.$transaction(async (tx) => {
    const anterior = await tx.entregaNotificacion.findUniqueOrThrow({ where: { id } });
    if (anterior.estado !== EstadoEntregaNotificacion.FALLIDA) {
      throw solicitudInvalida('Solo se pueden reintentar entregas fallidas');
    }

    const actualizada = await tx.entregaNotificacion.update({
      where: { id },
      data: {
        estado: EstadoEntregaNotificacion.PENDIENTE,
        proximoIntentoEn: new Date(),
        bloqueadoHasta: null,
        bloqueadoPor: null,
        ultimoError: null,
      },
    });

    await registrarAuditoria({
      usuarioId: req.autenticacion?.usuarioId,
      accion: 'REINTENTAR_ENTREGA_NOTIFICACION',
      tipoEntidad: 'EntregaNotificacion',
      idEntidad: id,
      datosAnteriores: anterior,
      datosNuevos: actualizada,
    }, tx);

    return actualizada;
  });

  responder(res, { entrega });
};
