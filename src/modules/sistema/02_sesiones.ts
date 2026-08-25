import type { Request, Response } from 'express';
import { prisma } from '../../db';
import { obtenerPaginacion } from '../../utils/paginacion';
import { responderLista } from '../../utils/respuesta';

export const listarSesionesSistema = async (req: Request, res: Response) => {
  const { pagina, limite, saltar } = obtenerPaginacion(req.query);

  const where = {
    ...(req.query.activas === 'true' ? { revocadoEn: null, expiraEn: { gt: new Date() } } : {}),
  };

  const [datos, total] = await prisma.$transaction([
    prisma.sesion.findMany({
      where,
      select: {
        id: true,
        usuarioId: true,
        expiraEn: true,
        ultimoUsoEn: true,
        revocadoEn: true,
        agenteUsuario: true,
        nombreDispositivo: true,
        direccionIp: true,
        creadoEn: true,
        actualizadoEn: true,
        usuario: {
          select: {
            id: true,
            nombreUsuario: true,
            nombre: true,
            rol: true,
            activo: true,
          },
        },
      },
      skip: saltar,
      take: limite,
      orderBy: { creadoEn: 'desc' },
    }),
    prisma.sesion.count({ where }),
  ]);

  responderLista(res, datos, { pagina, limite, total });
};
