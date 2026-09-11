import type { Request, Response } from 'express';
import { prisma } from '../../db';
import { responder } from '../../utils/respuesta';
import { areaEsAuditableEnPeriodo } from '../areas/servicio_vigencia_area';

export const obtenerAlertasAsignaciones = async (req: Request, res: Response) => {
  const ahora = new Date();
  const anio = req.query.anio ? Number(req.query.anio) : ahora.getFullYear();
  const mes = req.query.mes ? Number(req.query.mes) : ahora.getMonth() + 1;

  const ultimoDia = mes === 2 ? 28 : new Date(anio, mes, 0).getDate();

  const [areas, asignacionesMensuales] = await Promise.all([
    prisma.area.findMany({
      select: {
        id: true,
        codigo: true,
        nombre: true,
        tipo: true,
        activo: true,
        auditableDesde: true,
        auditableHasta: true,
      },
    }),
    prisma.asignacionMensual.findMany({
      where: { anio, mes },
      select: { areaId: true, auditorId: true },
    }),
  ]);

  const areasAuditables = areas.filter(
    (area) =>
      areaEsAuditableEnPeriodo(area, anio, mes, 15) ||
      areaEsAuditableEnPeriodo(area, anio, mes, ultimoDia),
  );

  const idsAsignados = new Set(
    asignacionesMensuales.filter((asig) => asig.auditorId !== null).map((asig) => asig.areaId),
  );

  const totalAreasAuditables = areasAuditables.length;
  const totalAsignaciones = areasAuditables.filter((area) => idsAsignados.has(area.id)).length;
  const faltantes = Math.max(0, totalAreasAuditables - totalAsignaciones);

  responder(res, {
    faltantes,
    totalAreas: totalAreasAuditables,
  });
};
