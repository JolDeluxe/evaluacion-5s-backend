import type { Request, Response } from 'express';
import { prisma } from '../../db';
import { prohibido } from '../../utils/errores';
import { tieneDetalleDeArea } from '../../utils/areas_permitidas';
import { responder } from '../../utils/respuesta';
import { esquemaEnvioId } from './zod';

export const listarEvidenciasEnvio = async (req: Request, res: Response) => {
  const { envioId } = esquemaEnvioId.parse(req.params);
  const envio = await prisma.envioAuditoria.findUniqueOrThrow({
    where: { id: envioId },
    select: { objetivoAuditoria: { select: { areaId: true } } },
  });
  const puedeVerDetalle = await tieneDetalleDeArea(prisma, req.autenticacion, envio.objetivoAuditoria.areaId);
  if (!puedeVerDetalle) throw prohibido('No tienes permiso para ver evidencias de esta area');
  const evidencias = await prisma.fotoAuditoria.findMany({
    where: { respuestaAuditoria: { envioAuditoriaId: envioId } },
    include: { respuestaAuditoria: { select: { id: true, preguntaFormularioId: true } } },
    orderBy: { creadoEn: 'asc' },
  });
  responder(res, { evidencias });
};
