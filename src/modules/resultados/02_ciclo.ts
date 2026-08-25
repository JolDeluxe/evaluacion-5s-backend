import type { Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../../db';
import { prohibido } from '../../utils/errores';
import { puedeAdministrar5S } from '../../utils/permisos';
import { construirDetalleAdminPeriodo } from '../../utils/periodos';
import { responder } from '../../utils/respuesta';

const esquemaParams = z.object({ id: z.coerce.number().int().positive() });

export const resultadosCiclo = async (req: Request, res: Response) => {
  if (!puedeAdministrar5S(req.autenticacion?.rol)) {
    throw prohibido('Solo administradores pueden ver el detalle completo del ciclo');
  }
  const { id } = esquemaParams.parse(req.params);
  const ciclo = await prisma.cicloAuditoria.findUniqueOrThrow({
    where: { id },
    include: { objetivosAuditoria: { include: { envioResultado: true, cicloAuditoria: true } } },
  });
  responder(res, {
    ciclo: {
      ...ciclo,
      objetivosAuditoria: ciclo.objetivosAuditoria.map((objetivo) => ({
        ...objetivo,
        periodo: construirDetalleAdminPeriodo(objetivo),
      })),
    },
  });
};
