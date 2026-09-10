import type { Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../../db';
import { RolUsuario } from '../../generated/prisma/enums';
import { obtenerPaginacion } from '../../utils/paginacion';
import { responderLista } from '../../utils/respuesta';
import { limpiarUsuario, seleccionarUsuarioSeguro } from './helper';

const esquemaQuery = z.object({
  busqueda: z.string().trim().optional(),
  rol: z.enum(RolUsuario).optional(),
  activo: z.coerce.boolean().optional(),
  responsabilidad: z.string().trim().optional(), // 'con' | 'sin'
  esComodin: z.coerce.boolean().optional(),
  puedeSerAsignadoAuditoria: z.coerce.boolean().optional(),
  seEvalua: z.coerce.boolean().optional(),
}).passthrough();

export const listarUsuarios = async (req: Request, res: Response) => {
  const { pagina, limite, saltar } = obtenerPaginacion(req.query);
  const query = esquemaQuery.parse(req.query);

  const where: Record<string, unknown> = {
    ...(query.rol ? { rol: query.rol } : {}),
    ...(query.activo === undefined ? {} : { activo: query.activo }),
    ...(query.esComodin === undefined ? {} : { esComodin: query.esComodin }),
    ...(query.puedeSerAsignadoAuditoria === undefined ? {} : { puedeSerAsignadoAuditoria: query.puedeSerAsignadoAuditoria }),
    ...(query.seEvalua === undefined ? {} : { seEvalua: query.seEvalua }),
  };

  if (query.busqueda) {
    where.OR = [
      { nombre: { contains: query.busqueda } },
      { nombreUsuario: { contains: query.busqueda } },
      { correo: { contains: query.busqueda } },
      {
        areasUsuario: {
          some: {
            area: {
              nombre: { contains: query.busqueda },
            },
          },
        },
      },
    ];
  }

  if (query.responsabilidad === 'con') {
    where.areasUsuario = {
      some: {},
    };
  } else if (query.responsabilidad === 'sin') {
    where.areasUsuario = {
      none: {},
    };
  }

  const [datos, total] = await prisma.$transaction([
    prisma.usuario.findMany({
      where,
      select: {
        ...seleccionarUsuarioSeguro,
        areasUsuario: {
          orderBy: { creadoEn: 'asc' },
          select: {
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

  responderLista(res, datos.map(limpiarUsuario), { pagina, limite, total });
};
