import type { Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../../db';
import { EstadoEntregaNotificacion } from '../../generated/prisma/enums';
import { conflicto, noEncontrado, solicitudInvalida } from '../../utils/errores';
import { responder } from '../../utils/respuesta';
import { registrarAuditoria } from '../registros_auditoria/helper';

const esquemaId = z.object({ id: z.coerce.number().int().positive() });

const esquemaMotivo = z.object({
  motivo: z.string().trim().max(300).optional(),
});

export const cancelarEntregaSistema = async (req: Request, res: Response) => {
  const { id } = esquemaId.parse(req.params);
  const { motivo } = esquemaMotivo.parse(req.body);
  const usuarioId = req.autenticacion?.usuarioId;

  const entrega = await prisma.$transaction(async (tx) => {
    const anterior = await tx.entregaNotificacion.findUnique({
      where: { id },
      include: { notificacion: true },
    });

    if (!anterior) {
      throw noEncontrado('Entrega no encontrada');
    }

    if (anterior.estado === EstadoEntregaNotificacion.PROCESANDO) {
      throw conflicto('No se puede cancelar una entrega que está en proceso de despacho');
    }

    if (
      anterior.estado !== EstadoEntregaNotificacion.PENDIENTE &&
      anterior.estado !== EstadoEntregaNotificacion.FALLIDA
    ) {
      throw solicitudInvalida(
        `No se puede cancelar una entrega en estado ${anterior.estado}. Solo entregas PENDIENTE o FALLIDA son cancelables.`
      );
    }

    const mensajeCancelacion = motivo || 'Cancelada manualmente por SUPER_ADMIN';

    const actualizada = await tx.entregaNotificacion.update({
      where: { id },
      data: {
        estado: EstadoEntregaNotificacion.CANCELADA,
        proximoIntentoEn: null,
        ultimoError: mensajeCancelacion,
        bloqueadoHasta: null,
        bloqueadoPor: null,
      },
    });

    await registrarAuditoria(
      {
        usuarioId,
        accion: 'CANCELAR_ENTREGA',
        tipoEntidad: 'EntregaNotificacion',
        idEntidad: id,
        datosAnteriores: anterior,
        datosNuevos: actualizada,
      },
      tx
    );

    return actualizada;
  });

  responder(res, {
    mensaje: 'Entrega cancelada correctamente.',
    entrega,
  });
};

const esquemaMasivo = z.object({
  ids: z.array(z.number().int().positive()).min(1).max(500),
  motivo: z.string().trim().max(300).optional(),
});

export const cancelarEntregasMasivoSistema = async (req: Request, res: Response) => {
  const { ids, motivo } = esquemaMasivo.parse(req.body);
  const usuarioId = req.autenticacion?.usuarioId;

  const mensajeCancelacion = motivo || 'Cancelada en lote por SUPER_ADMIN';

  const resultado = await prisma.$transaction(async (tx) => {
    const entregasElegibles = await tx.entregaNotificacion.findMany({
      where: {
        id: { in: ids },
        estado: {
          in: [EstadoEntregaNotificacion.PENDIENTE, EstadoEntregaNotificacion.FALLIDA],
        },
      },
      select: { id: true, estado: true, destinoSnapshot: true },
    });

    if (entregasElegibles.length === 0) {
      throw solicitudInvalida(
        'Ninguna de las entregas seleccionadas es elegible para cancelación (deben estar en PENDIENTE o FALLIDA).'
      );
    }

    const idsParaCancelar = entregasElegibles.map((e) => e.id);

    const updateRes = await tx.entregaNotificacion.updateMany({
      where: {
        id: { in: idsParaCancelar },
      },
      data: {
        estado: EstadoEntregaNotificacion.CANCELADA,
        proximoIntentoEn: null,
        ultimoError: mensajeCancelacion,
        bloqueadoHasta: null,
        bloqueadoPor: null,
      },
    });

    await registrarAuditoria(
      {
        usuarioId,
        accion: 'CANCELAR_ENTREGAS_MASIVAS',
        tipoEntidad: 'EntregaNotificacion',
        idEntidad: 0,
        datosAnteriores: { seleccionados: ids, encontradosElegibles: idsParaCancelar },
        datosNuevos: { canceladas: updateRes.count, motivo: mensajeCancelacion },
      },
      tx
    );

    return {
      canceladas: updateRes.count,
      idsCancelados: idsParaCancelar,
      omitidos: ids.length - updateRes.count,
    };
  });

  responder(res, {
    mensaje: `Se cancelaron exitosamente ${resultado.canceladas} entregas.`,
    ...resultado,
  });
};

export const detalleEntregaSistema = async (req: Request, res: Response) => {
  const { id } = esquemaId.parse(req.params);

  const entrega = await prisma.entregaNotificacion.findUnique({
    where: { id },
    include: {
      notificacion: {
        include: {
          usuario: {
            select: {
              id: true,
              nombre: true,
              correo: true,
              activo: true,
              rol: true,
            },
          },
        },
      },
      suscripcionPush: true,
    },
  });

  if (!entrega) {
    throw noEncontrado('Entrega no encontrada');
  }

  const esDestinatarioPrueba = Boolean(
    entrega.destinoSnapshot && entrega.destinoSnapshot.includes('example.test')
  );

  responder(res, {
    entrega: {
      ...entrega,
      esDestinatarioPrueba,
    },
  });
};
