import type { Request, Response } from 'express';
import { prisma } from '../../db';
import { objetivoEsRealizable } from '../../utils/periodos';
import { responder } from '../../utils/respuesta';
import { asegurarInvitadoPublicoHabilitado } from './token_publico';

export const listarAreasPublicasInvitado = async (_req: Request, res: Response) => {
  asegurarInvitadoPublicoHabilitado();
  const ahora = new Date();
  const objetivos = await prisma.objetivoAuditoria.findMany({
    where: {
      area: { activo: true },
      cicloAuditoria: { iniciaEn: { lte: ahora } },
    },
    include: { area: true, cicloAuditoria: true, envioResultado: true },
  });

  const areasPorId = new Map<number, { id: number; codigo: string; nombre: string; tipo: string }>();
  for (const objetivo of objetivos) {
    if (!objetivoEsRealizable(objetivo, ahora)) continue;
    if (areasPorId.has(objetivo.areaId)) continue;
    areasPorId.set(objetivo.areaId, {
      id: objetivo.area.id,
      codigo: objetivo.area.codigo,
      nombre: objetivo.area.nombre,
      tipo: objetivo.area.tipo,
    });
  }

  responder(res, {
    areas: [...areasPorId.values()].sort((a, b) => a.nombre.localeCompare(b.nombre)),
  });
};
