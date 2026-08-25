import type { Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../../db';
import { obtenerPaginacion, esquemaPaginacion } from '../../utils/paginacion';
import { responderLista } from '../../utils/respuesta';

const esquemaQuery = esquemaPaginacion.extend({
  usuarioId: z.coerce.number().int().positive().optional(),
  accion: z.string().trim().min(1).optional(),
  tipoEntidad: z.string().trim().min(1).optional(),
  idEntidad: z.coerce.number().int().positive().optional(),
});

export const listarRegistrosAuditoria = async (req: Request, res: Response) => {
  const query = esquemaQuery.parse(req.query);
  const { saltar, pagina, limite } = obtenerPaginacion(query);

  const where = {
    usuarioId: query.usuarioId,
    accion: query.accion,
    tipoEntidad: query.tipoEntidad,
    idEntidad: query.idEntidad,
  };

  const [items, total] = await Promise.all([
    prisma.registroAuditoria.findMany({
      where,
      orderBy: { creadoEn: 'desc' },
      take: limite,
      skip: saltar,
      include: {
        usuario: {
          select: {
            id: true,
            nombreUsuario: true,
            nombre: true,
            rol: true,
          },
        },
      },
    }),
    prisma.registroAuditoria.count({ where }),
  ]);

  responderLista(res, items, { pagina, limite, total });
};
