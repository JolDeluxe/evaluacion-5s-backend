import type { Request, Response } from 'express';
import { prisma } from '../../db';
import { prohibido } from '../../utils/errores';
import { tieneDetalleDeArea } from '../../utils/areas_permitidas';
import { puedeAdministrar5S } from '../../utils/permisos';
import { construirDetalleAdminPeriodo, construirDetalleAuditorPeriodo } from '../../utils/periodos';
import { responder } from '../../utils/respuesta';
import { esquemaArea } from './zod';

export const historialArea = async (req: Request, res: Response) => {
  const { id } = esquemaArea.parse(req.params);
  const puedeVerDetalle = await tieneDetalleDeArea(prisma, req.autenticacion, id);
  if (!puedeVerDetalle) throw prohibido('No tienes permiso para ver el historico detallado de esta area');
  const objetivos = await prisma.objetivoAuditoria.findMany({
    where: { areaId: id },
    include: {
      envioResultado: true,
      cicloAuditoria: true,
      enviosAuditoria: {
        where: { invalidadoEn: null },
        orderBy: [{ recibidoEn: 'asc' }, { id: 'asc' }],
      },
    },
    orderBy: [{ cicloAuditoria: { anio: 'desc' } }, { cicloAuditoria: { mes: 'desc' } }],
  });
  const esAdmin = puedeAdministrar5S(req.autenticacion?.rol);
  responder(res, {
    historial: objetivos.map((objetivo) => {
      const basePeriodo = esAdmin
        ? construirDetalleAdminPeriodo(objetivo)
        : construirDetalleAuditorPeriodo(objetivo);
      return {
        ...objetivo,
        periodo: {
          ...basePeriodo,
          envioResultadoId: objetivo.envioResultadoId,
          envios: objetivo.enviosAuditoria || [],
        },
      };
    }),
  });
};
