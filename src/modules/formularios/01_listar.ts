import type { Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../../db';
import { AlcanceFormulario } from '../../generated/prisma/enums';
import { obtenerPaginacion } from '../../utils/paginacion';
import { responderLista } from '../../utils/respuesta';
import { includeRevisionFormularioConEstructura, mapearFormularioDetalle } from './helper';

const esquemaQuery = z.object({
  busqueda: z.string().trim().optional(),
  alcance: z.enum(AlcanceFormulario).optional(),
  activo: z.coerce.boolean().optional(),
}).passthrough();

export const listarFormularios = async (req: Request, res: Response) => {
  const { pagina, limite, saltar } = obtenerPaginacion(req.query);
  const query = esquemaQuery.parse(req.query);
  const where = {
    ...(query.alcance ? { alcance: query.alcance } : {}),
    ...(query.activo === undefined ? {} : { activo: query.activo }),
    ...(query.busqueda ? { OR: [{ nombre: { contains: query.busqueda } }, { slug: { contains: query.busqueda } }] } : {}),
  };
  const [datos, total] = await prisma.$transaction([
    prisma.formulario.findMany({
      where,
      include: {
        versiones: {
          orderBy: { numeroVersion: 'desc' },
          include: includeRevisionFormularioConEstructura,
        },
      },
      skip: saltar,
      take: limite,
      orderBy: { creadoEn: 'desc' },
    }),
    prisma.formulario.count({ where }),
  ]);
  responderLista(res, datos.map(mapearFormularioDetalle), { pagina, limite, total });
};
