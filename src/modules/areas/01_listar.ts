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
  };

  if (query.busqueda) {
    where.OR = [
      { codigo: { contains: query.busqueda } },
      { nombre: { contains: query.busqueda } },
      {
        usuariosArea: {
          some: {
            usuario: {
              nombre: { contains: query.busqueda },
            },
          },
        },
      },
    ];
  }

  // Filtro de responsable:
  // sinResponsable=true  → áreas sin ningún registro en usuariosArea
  // sinResponsable=false → áreas que sí tienen al menos un registro en usuariosArea
  if (query.sinResponsable === true) {
    where.usuariosArea = { none: {} };
  } else if (query.sinResponsable === false) {
    where.usuariosArea = { some: {} };
  }

  const [datos, total] = await prisma.$transaction([
    prisma.area.findMany({
      where,
      include: {
        usuariosArea: {
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
