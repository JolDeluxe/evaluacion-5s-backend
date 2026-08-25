import type { Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../../db';
import { TipoArea } from '../../generated/prisma/enums';
import { obtenerPaginacion } from '../../utils/paginacion';
import { responderLista } from '../../utils/respuesta';

const esquemaQuery = z.object({
  busqueda: z.string().trim().optional(),
  tipo: z.enum(TipoArea).optional(),
  activo: z.coerce.boolean().optional(),
  // true  → solo áreas sin ningún responsable
  // false → solo áreas que sí tienen responsable
  sinResponsable: z.coerce.boolean().optional(),
}).passthrough();

export const listarAreas = async (req: Request, res: Response) => {
  const { pagina, limite, saltar } = obtenerPaginacion(req.query);
  const query = esquemaQuery.parse(req.query);

  const where: Record<string, unknown> = {
    ...(query.tipo ? { tipo: query.tipo } : {}),
    ...(query.activo === undefined ? {} : { activo: query.activo }),
    ...(query.busqueda
      ? {
          OR: [
            { codigo: { contains: query.busqueda } },
            { nombre: { contains: query.busqueda } },
          ],
        }
      : {}),
  };

  // Filtro de responsable:
  // sinResponsable=true  → áreas cuyo usuariosArea no tiene ningún registro esResponsable=true
  // sinResponsable=false → áreas que sí tienen al menos un responsable
  if (query.sinResponsable === true) {
    where['usuariosArea'] = { none: { esResponsable: true } };
  } else if (query.sinResponsable === false) {
    where['usuariosArea'] = { some: { esResponsable: true } };
  }

  const [datos, total] = await prisma.$transaction([
    prisma.area.findMany({
      where,
      include: {
        areaPadre: { select: { id: true, codigo: true, nombre: true } },
        usuariosArea: {
          orderBy: [{ esResponsable: 'desc' }, { creadoEn: 'asc' }],
          include: {
            usuario: {
              select: { id: true, nombre: true, nombreUsuario: true, rol: true },
            },
          },
        },
      },
      skip: saltar,
      take: limite,
      orderBy: [{ tipo: 'asc' }, { nombre: 'asc' }],
    }),
    prisma.area.count({ where }),
  ]);

  responderLista(res, datos, { pagina, limite, total });
};
