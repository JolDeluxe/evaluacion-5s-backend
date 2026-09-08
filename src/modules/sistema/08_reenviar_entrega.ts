import type { Request, Response } from 'express';
import { z } from 'zod';
import { CanalNotificacion, EstadoEntregaNotificacion } from '../../generated/prisma/enums';
import { prisma } from '../../db';
import { solicitudInvalida } from '../../utils/errores';
import { responder } from '../../utils/respuesta';
import { registrarAuditoria } from '../registros_auditoria/helper';

const esquemaId = z.object({ id: z.coerce.number().int().positive() });

export const reenviarEntregaCorreoSistema = async (req: Request, res: Response) => {
  const { id } = esquemaId.parse(req.params);

  const entrega = await prisma.$transaction(async (tx) => {
    const entregaOriginal = await tx.entregaNotificacion.findUniqueOrThrow({
      where: { id },
      include: { notificacion: true },
    });

    if (entregaOriginal.estado !== EstadoEntregaNotificacion.ENVIADA) {
      throw solicitudInvalida(
        'Solo se pueden reenviar entregas que ya hayan sido marcadas como ENVIADA. Para reintentar una entrega fallida utiliza el endpoint de reintento.'
      );
    }

    if (entregaOriginal.canal !== CanalNotificacion.CORREO) {
      throw solicitudInvalida('El reenvío manual solo está disponible para entregas por canal CORREO.');
    }

    const timestamp = Date.now();
    const claveDedupe = `reenvio-manual:${id}:${timestamp}`;

    const nuevaNotificacion = await tx.notificacion.create({
      data: {
        usuarioId: entregaOriginal.notificacion.usuarioId,
        claveDedupe,
        tipo: entregaOriginal.notificacion.tipo,
        titulo: entregaOriginal.notificacion.titulo,
        mensaje: entregaOriginal.notificacion.mensaje,
        ruta: entregaOriginal.notificacion.ruta,
        datos: (entregaOriginal.notificacion.datos ?? undefined) as any,
      },
    });

    const nuevaEntrega = await tx.entregaNotificacion.create({
      data: {
        notificacionId: nuevaNotificacion.id,
        canal: CanalNotificacion.CORREO,
        estado: EstadoEntregaNotificacion.PENDIENTE,
        destinoSnapshot: entregaOriginal.destinoSnapshot,
        destinoHash: entregaOriginal.destinoHash,
        programadoEn: new Date(),
      },
    });

    await registrarAuditoria({
      usuarioId: req.autenticacion?.usuarioId,
      accion: 'REENVIAR_ENTREGA_CORREO',
      tipoEntidad: 'EntregaNotificacion',
      idEntidad: nuevaEntrega.id,
      datosAnteriores: { idEntregaOriginal: id },
      datosNuevos: nuevaEntrega,
    }, tx);

    return nuevaEntrega;
  });

  responder(res, { mensaje: 'Reenvío de correo programado correctamente.', entrega });
};