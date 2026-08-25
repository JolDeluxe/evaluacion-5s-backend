import type { Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../../db';
import { EstadoAsignacionAuditoria } from '../../generated/prisma/enums';
import { obtenerPaginacion } from '../../utils/paginacion';
import { puedeAdministrar5S } from '../../utils/permisos';
import { responderLista } from '../../utils/respuesta';

const esquemaQuery = z.object({
  estado: z.enum(EstadoAsignacionAuditoria).optional(),
  auditorId: z.coerce.number().int().positive().optional(),
  objetivoAuditoriaId: z.coerce.number().int().positive().optional(),
}).passthrough();

export const listarAsignaciones = async (req: Request, res: Response) => {
  const { pagina, limite, saltar } = obtenerPaginacion(req.query);
  const query = esquemaQuery.parse(req.query);
  const esAdmin = puedeAdministrar5S(req.autenticacion?.rol);
  const where = {
    ...(query.estado ? { estado: query.estado } : {}),
    ...(esAdmin && query.auditorId ? { auditorId: query.auditorId } : {}),
    ...(!esAdmin ? { auditorId: req.autenticacion?.usuarioId ?? 0 } : {}),
    ...(query.objetivoAuditoriaId ? { objetivoAuditoriaId: query.objetivoAuditoriaId } : {}),
  };
  const [datos, total] = await prisma.$transaction([
    prisma.asignacionAuditoria.findMany({ where, include: { auditor: { select: { id: true, nombre: true, nombreUsuario: true } }, objetivoAuditoria: true }, skip: saltar, take: limite, orderBy: { venceEn: 'asc' } }),
    prisma.asignacionAuditoria.count({ where }),
  ]);
  responderLista(res, datos, { pagina, limite, total });
};
