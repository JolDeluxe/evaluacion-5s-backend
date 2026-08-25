import type { Request, Response } from 'express';
import { prisma } from '../../db';
import { noAutenticado } from '../../utils/errores';
import { obtenerPaginacion } from '../../utils/paginacion';
import { responderLista } from '../../utils/respuesta';

export const listarNotificaciones = async (req: Request, res: Response) => {
  if (!req.autenticacion) throw noAutenticado();
  const { pagina, limite, saltar } = obtenerPaginacion(req.query);
  const where = { usuarioId: req.autenticacion.usuarioId };
  const [datos, total] = await prisma.$transaction([
    prisma.notificacion.findMany({ where, skip: saltar, take: limite, orderBy: { creadoEn: 'desc' } }),
    prisma.notificacion.count({ where }),
  ]);
  responderLista(res, datos, { pagina, limite, total });
};
