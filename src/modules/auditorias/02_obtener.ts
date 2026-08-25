import type { Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../../db';
import { prohibido } from '../../utils/errores';
import { tieneDetalleDeArea } from '../../utils/areas_permitidas';
import { responder } from '../../utils/respuesta';

const esquemaId = z.object({ id: z.coerce.number().int().positive() });

export const obtenerAuditoria = async (req: Request, res: Response) => {
  const { id } = esquemaId.parse(req.params);
  const envio = await prisma.envioAuditoria.findUniqueOrThrow({
    where: { id },
    include: {
      objetivoAuditoria: true,
      respuestasAuditoria: { include: { preguntaFormulario: true, fotosAuditoria: true } },
    },
  });
  const puedeVerDetalle = await tieneDetalleDeArea(prisma, req.autenticacion, envio.objetivoAuditoria.areaId);
  if (!puedeVerDetalle) throw prohibido('No tienes permiso para ver el detalle de esta area');
  responder(res, { envio });
};
