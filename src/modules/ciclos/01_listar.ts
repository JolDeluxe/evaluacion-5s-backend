import type { Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../../db';
import { EstadoCicloAuditoria } from '../../generated/prisma/enums';
import { obtenerPaginacion } from '../../utils/paginacion';
import { responderLista } from '../../utils/respuesta';

const esquemaQuery = z.object({
  anio: z.coerce.number().int().optional(),
  mes: z.coerce.number().int().optional(),
  estado: z.enum(EstadoCicloAuditoria).optional(),
}).passthrough();

export const listarCiclos = async (req: Request, res: Response) => {
  const { pagina, limite, saltar } = obtenerPaginacion(req.query);
  const query = esquemaQuery.parse(req.query);
  const where = {
    ...(query.anio ? { anio: query.anio } : {}),
    ...(query.mes ? { mes: query.mes } : {}),
    ...(query.estado ? { estado: query.estado } : {}),
  };
  const [datos, total] = await prisma.$transaction([
    prisma.cicloAuditoria.findMany({ where, include: { formulariosCiclo: true }, skip: saltar, take: limite, orderBy: [{ anio: 'desc' }, { mes: 'desc' }, { numeroCorte: 'desc' }] }),
    prisma.cicloAuditoria.count({ where }),
  ]);
  responderLista(res, datos, { pagina, limite, total });
};
