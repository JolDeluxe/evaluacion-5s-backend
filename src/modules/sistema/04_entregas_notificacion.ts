import type { Request, Response } from 'express';
import { z } from 'zod';
import { CanalNotificacion, EstadoEntregaNotificacion } from '../../generated/prisma/enums';
import { prisma } from '../../db';
import { obtenerPaginacion } from '../../utils/paginacion';
import { responderLista } from '../../utils/respuesta';

const esquemaQuery = z.object({
  canal: z.enum(CanalNotificacion).optional(),
  estado: z.enum(EstadoEntregaNotificacion).optional(),
  desde: z.coerce.date().optional(),
  hasta: z.coerce.date().optional(),
}).passthrough();

export const listarEntregasNotificacionSistema = async (req: Request, res: Response) => {
  const { pagina, limite, saltar } = obtenerPaginacion(req.query);
  const query = esquemaQuery.parse(req.query);
  const where = {
    ...(query.canal ? { canal: query.canal } : {}),
    ...(query.estado ? { estado: query.estado } : {}),
    ...((query.desde || query.hasta) ? { creadoEn: { ...(query.desde ? { gte: query.desde } : {}), ...(query.hasta ? { lte: query.hasta } : {}) } } : {}),
  };

  const [datos, total] = await prisma.$transaction([
    prisma.entregaNotificacion.findMany({
      where,
      select: {
        id: true,
        canal: true,
        estado: true,
        destinoSnapshot: true,
        programadoEn: true,
        proximoIntentoEn: true,
        bloqueadoHasta: true,
        bloqueadoPor: true,
        intentos: true,
        enviadoEn: true,
        ultimoIntentoEn: true,
        idMensajeExterno: true,
        ultimoError: true,
        creadoEn: true,
        actualizadoEn: true,
        notificacion: { select: { id: true, tipo: true, titulo: true, usuarioId: true, creadoEn: true } },
      },
      skip: saltar,
      take: limite,
      orderBy: { creadoEn: 'desc' },
    }),
    prisma.entregaNotificacion.count({ where }),
  ]);

  responderLista(res, datos, { pagina, limite, total });
};
