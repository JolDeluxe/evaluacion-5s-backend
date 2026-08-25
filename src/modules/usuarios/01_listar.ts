import type { Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../../db';
import { RolUsuario } from '../../generated/prisma/enums';
import { obtenerPaginacion } from '../../utils/paginacion';
import { responderLista } from '../../utils/respuesta';
import { seleccionarUsuarioSeguro } from './helper';

const esquemaQuery = z.object({
  busqueda: z.string().trim().optional(),
  rol: z.enum(RolUsuario).optional(),
  activo: z.coerce.boolean().optional(),
}).passthrough();

export const listarUsuarios = async (req: Request, res: Response) => {
  const { pagina, limite, saltar } = obtenerPaginacion(req.query);
  const query = esquemaQuery.parse(req.query);
  const where = {
    ...(query.rol ? { rol: query.rol } : {}),
    ...(query.activo === undefined ? {} : { activo: query.activo }),
    ...(query.busqueda
      ? {
          OR: [
            { nombre: { contains: query.busqueda } },
            { nombreUsuario: { contains: query.busqueda } },
            { correo: { contains: query.busqueda } },
          ],
        }
      : {}),
  };

  const [datos, total] = await prisma.$transaction([
    prisma.usuario.findMany({
      where,
      select: {
        ...seleccionarUsuarioSeguro,
        areasUsuario: {
          orderBy: [{ esResponsable: 'desc' }, { creadoEn: 'asc' }],
          select: {
            esResponsable: true,
            area: { select: { id: true, codigo: true, nombre: true, tipo: true } },
          },
        },
      },
      skip: saltar,
      take: limite,
      orderBy: { creadoEn: 'desc' },
    }),
    prisma.usuario.count({ where }),
  ]);

  responderLista(res, datos, { pagina, limite, total });
};
