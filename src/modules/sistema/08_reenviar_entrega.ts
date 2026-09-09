import type { Request, Response } from 'express';
import { z } from 'zod';
import { CanalNotificacion, EstadoEntregaNotificacion } from '../../generated/prisma/enums';
import { prisma } from '../../db';
import { noEncontrado, solicitudInvalida } from '../../utils/errores';
import { responder } from '../../utils/respuesta';
import { registrarAuditoria } from '../registros_auditoria/helper';
import { hashSha256 } from '../../utils/crypto';

const esquemaId = z.object({ id: z.coerce.number().int().positive() });

export const reenviarEntregaCorreoSistema = async (req: Request, res: Response) => {
  const { id } = esquemaId.parse(req.params);

  const resultado = await prisma.$transaction(async (tx) => {
    const entregaOriginal = await tx.entregaNotificacion.findUnique({
      where: { id },
      include: { notificacion: true },
    });

    if (!entregaOriginal) {
      throw noEncontrado(`Entrega #${id} no encontrada.`);
    }

    if (entregaOriginal.estado !== EstadoEntregaNotificacion.ENVIADA) {
      throw solicitudInvalida(
        'Solo se pueden reenviar entregas que ya hayan sido marcadas como ENVIADA. Para reintentar una entrega fallida utiliza el endpoint de reintento.'
      );
    }

    if (entregaOriginal.canal !== CanalNotificacion.CORREO) {
      throw solicitudInvalida('El reenvío manual solo está disponible para entregas por canal CORREO.');
    }

    // Consultar el usuario relacionado en la base de datos para obtener sus datos ACTUALES
    const usuario = await tx.usuario.findUnique({
      where: { id: entregaOriginal.notificacion.usuarioId },
      select: {
        id: true,
        nombre: true,
        correo: true,
        activo: true,
      },
    });

    if (!usuario) {
      throw solicitudInvalida(
        'No se puede reenviar el correo porque el usuario destinatario ya no existe en el sistema.'
      );
    }

    if (!usuario.activo) {
      throw solicitudInvalida(
        `No se puede reenviar el correo porque el usuario "${usuario.nombre}" está inactivo o dado de baja.`
      );
    }

    const correoActual = usuario.correo?.trim().toLowerCase();
    if (!correoActual) {
      throw solicitudInvalida(
        `No se puede reenviar el correo porque el usuario "${usuario.nombre}" no tiene una dirección de correo configurada actualmente.`
      );
    }

    const destinoHash = hashSha256(correoActual);
    const timestamp = Date.now();
    const claveDedupe = `reenvio-manual:${id}:${timestamp}`;

    // La entrega original y su notificación NUNCA se modifican
    const nuevaNotificacion = await tx.notificacion.create({
      data: {
        usuarioId: usuario.id,
        claveDedupe,
        tipo: entregaOriginal.notificacion.tipo,
        titulo: entregaOriginal.notificacion.titulo,
        mensaje: entregaOriginal.notificacion.mensaje,
        ruta: entregaOriginal.notificacion.ruta,
        datos: (entregaOriginal.notificacion.datos ?? undefined) as import('../../generated/prisma/client').Prisma.InputJsonValue,
      },
    });

    const nuevaEntrega = await tx.entregaNotificacion.create({
      data: {
        notificacionId: nuevaNotificacion.id,
        canal: CanalNotificacion.CORREO,
        estado: EstadoEntregaNotificacion.PENDIENTE,
        destinoSnapshot: correoActual,
        destinoHash,
        programadoEn: new Date(),
        intentos: 0,
        proximoIntentoEn: null,
      },
    });

    // Registrar en auditoría que el reenvío partió de la entrega original #id
    await registrarAuditoria(
      {
        usuarioId: req.autenticacion?.usuarioId,
        accion: 'REENVIAR_ENTREGA_CORREO',
        tipoEntidad: 'EntregaNotificacion',
        idEntidad: nuevaEntrega.id,
        datosAnteriores: {
          idEntregaOriginal: id,
          destinoOriginal: entregaOriginal.destinoSnapshot,
        },
        datosNuevos: {
          idNuevaEntrega: nuevaEntrega.id,
          destinoActual: correoActual,
          usuarioId: usuario.id,
          usuarioNombre: usuario.nombre,
        },
      },
      tx
    );

    const destinoOriginalNorm = entregaOriginal.destinoSnapshot?.trim().toLowerCase() ?? '';
    const cambioDestino = destinoOriginalNorm !== correoActual;

    return {
      nuevaEntrega,
      destinoOriginal: entregaOriginal.destinoSnapshot,
      destinoActual: correoActual,
      cambioDestino,
      usuarioNombre: usuario.nombre,
    };
  });

  responder(res, {
    mensaje: resultado.cambioDestino
      ? `Reenvío programado hacia el correo actual del usuario (${resultado.destinoActual}).`
      : 'Reenvío de correo programado correctamente.',
    entrega: resultado.nuevaEntrega,
    destinoOriginal: resultado.destinoOriginal,
    destinoActual: resultado.destinoActual,
    cambioDestino: resultado.cambioDestino,
  });
};