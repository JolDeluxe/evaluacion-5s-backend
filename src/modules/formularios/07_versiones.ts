import type { Request, Response } from 'express';
import { prisma } from '../../db';
import { responder } from '../../utils/respuesta';
import { includeRevisionFormularioConEstructura, mapearRevisionFormulario } from './helper';
import { esquemaId } from './zod';

export const listarVersiones = async (req: Request, res: Response) => {
  const { id } = esquemaId.parse(req.params);
  const versiones = await prisma.versionFormulario.findMany({
    where: { formularioId: id },
    include: includeRevisionFormularioConEstructura,
    orderBy: { numeroVersion: 'desc' },
  });
  responder(res, {
    historial: versiones.map((revision) => {
      const resumen = mapearRevisionFormulario(revision);
      return {
        id: resumen.id,
        actual: resumen.actual,
        creadoEn: resumen.creadoEn,
        actualizadoEn: resumen.actualizadoEn,
        totalSecciones: resumen.totalSecciones,
        totalPreguntas: resumen.totalPreguntas,
      };
    }),
  });
};
