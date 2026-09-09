import type { Request, Response } from 'express';
import { z } from 'zod';
import { CanalNotificacion, EstadoEntregaNotificacion } from '../../generated/prisma/enums';
import { prisma } from '../../db';
import { responderLista } from '../../utils/respuesta';

const esquemaQuery = z.object({
  canal: z.enum(CanalNotificacion).optional(),
  estado: z.enum(EstadoEntregaNotificacion).optional(),
  desde: z.coerce.date().optional(),
  hasta: z.coerce.date().optional(),
  cursor: z.coerce.number().int().positive().optional(),
  limite: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().optional(),
  pagina: z.coerce.number().int().positive().optional(),
  page: z.coerce.number().int().positive().optional(),
}).passthrough();

export const listarEntregasNotificacionSistema = async (req: Request, res: Response) => {
  const query = esquemaQuery.parse(req.query);
  const limite = query.limite ?? query.limit ?? 100;
  const cursorId = query.cursor;

  const where = {
    ...(query.canal ? { canal: query.canal } : {}),
    ...(query.estado ? { estado: query.estado } : {}),
    ...((query.desde || query.hasta) ? { creadoEn: { ...(query.desde ? { gte: query.desde } : {}), ...(query.hasta ? { lte: query.hasta } : {}) } } : {}),
  };

  const total = await prisma.entregaNotificacion.count({ where });

  // Paginación por cursor o por offset (fallback/compatibilidad)
  let skip = 0;
  let cursorObj: { id: number } | undefined = undefined;

  if (cursorId) {
    cursorObj = { id: cursorId };
    skip = 1;
  } else if (query.pagina || query.page) {
    const pagina = Number(query.pagina || query.page || 1);
    const totalPaginas = Math.max(1, Math.ceil(total / (limite || 1)));
    const paginaEfectiva = total > 0 && pagina > totalPaginas ? totalPaginas : pagina;
    skip = (paginaEfectiva - 1) * limite;
  }

  // Solicitamos limite + 1 para determinar con certeza si hay más registros
  const registros = await prisma.entregaNotificacion.findMany({
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
      notificacion: {
        select: {
          id: true,
          tipo: true,
          titulo: true,
          usuarioId: true,
          creadoEn: true,
          usuario: {
            select: {
              id: true,
              nombre: true,
              correo: true,
              activo: true,
            },
          },
        },
      },
    },
    cursor: cursorObj,
    skip,
    take: limite + 1,
    orderBy: [
      { creadoEn: 'desc' },
      { id: 'desc' },
    ],
  });

  const hayMas = registros.length > limite;
  const datos = hayMas ? registros.slice(0, limite) : registros;
  const siguienteCursor = hayMas && datos.length > 0 ? datos[datos.length - 1].id : null;

  responderLista(res, datos, {
    pagina: query.pagina || query.page || 1,
    limite,
    total,
    hayMas,
    hasMore: hayMas,
    siguienteCursor,
    nextCursor: siguienteCursor ? String(siguienteCursor) : null,
  });
};
