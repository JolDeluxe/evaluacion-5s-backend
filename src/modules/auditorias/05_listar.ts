import type { Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../../db';
import { OrigenEnvioAuditoria } from '../../generated/prisma/enums';
import { obtenerAreaIdsConDetalle } from '../../utils/areas_permitidas';
import { obtenerPaginacion } from '../../utils/paginacion';
import { puedeAdministrar5S } from '../../utils/permisos';
import { responderLista } from '../../utils/respuesta';

const esquemaQuery = z.object({
  origen: z.enum(OrigenEnvioAuditoria).optional(),
  objetivoAuditoriaId: z.coerce.number().int().positive().optional(),
  areaId: z.coerce.number().int().positive().optional(),
}).passthrough();

export const listarAuditorias = async (req: Request, res: Response) => {
  const { pagina, limite, saltar } = obtenerPaginacion(req.query);
  const query = esquemaQuery.parse(req.query);
  const esAdmin = puedeAdministrar5S(req.autenticacion?.rol);
  const areaIdsDetalle = await obtenerAreaIdsConDetalle(prisma, req.autenticacion);
  const where = {
    ...(query.origen ? { origen: query.origen } : {}),
    ...(query.objetivoAuditoriaId ? { objetivoAuditoriaId: query.objetivoAuditoriaId } : {}),
    ...(query.areaId ? { objetivoAuditoria: { areaId: query.areaId } } : {}),
    ...(!esAdmin ? { enviadoPorUsuarioId: req.autenticacion?.usuarioId ?? 0 } : {}),
    ...(areaIdsDetalle && !query.areaId ? { objetivoAuditoria: { areaId: { in: areaIdsDetalle } } } : {}),
  };

  const [datos, total] = await prisma.$transaction([
    prisma.envioAuditoria.findMany({
      where,
      include: {
        objetivoAuditoria: true,
        enviadoPorUsuario: { select: { id: true, nombre: true, nombreUsuario: true, rol: true } },
        enlaceInvitado: { select: { id: true, expiraEn: true, usadoEn: true } },
      },
      skip: saltar,
      take: limite,
      orderBy: { recibidoEn: 'desc' },
    }),
    prisma.envioAuditoria.count({ where }),
  ]);

  responderLista(res, datos, { pagina, limite, total });
};
