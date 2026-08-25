import type { Request, Response } from 'express';
import { prisma } from '../../db';
import { obtenerAreaIdsConDetalle } from '../../utils/areas_permitidas';
import { puedeAdministrar5S } from '../../utils/permisos';
import { construirDetalleAdminPeriodo, construirDetalleAuditorPeriodo, tieneEnvioResultadoValido } from '../../utils/periodos';
import { responder } from '../../utils/respuesta';
import { calcularGanadores, construirWhereCiclo, promedio } from './helper';
import { esquemaFiltros } from './zod';

export const resultadosAreas = async (req: Request, res: Response) => {
  const filtros = esquemaFiltros.parse(req.query);
  const esAdmin = puedeAdministrar5S(req.autenticacion?.rol);
  const areaIdsDetalle = await obtenerAreaIdsConDetalle(prisma, req.autenticacion);
  const objetivos = await prisma.objetivoAuditoria.findMany({
    where: { tipoAreaSnapshot: filtros.tipoArea, cicloAuditoria: construirWhereCiclo(filtros) },
    include: {
      envioResultado: true,
      cicloAuditoria: true,
      enviosAuditoria: {
        where: { invalidadoEn: null },
        orderBy: [{ recibidoEn: 'asc' }, { id: 'asc' }],
      },
    },
    orderBy: { nombreAreaSnapshot: 'asc' },
  });

  const objetivosPorArea = new Map<number, typeof objetivos>();
  for (const objetivo of objetivos) {
    const actuales = objetivosPorArea.get(objetivo.areaId) ?? [];
    actuales.push(objetivo);
    objetivosPorArea.set(objetivo.areaId, actuales);
  }

  const areas = [...objetivosPorArea.entries()].map(([areaId, objetivosArea]) => {
    const porcentajes = objetivosArea.flatMap((objetivo) => (
      tieneEnvioResultadoValido(objetivo) ? [Number(objetivo.envioResultado?.porcentaje ?? 0)] : []
    ));
    const periodosProgramados = objetivosArea.length;
    const periodosRealizados = objetivosArea.filter((objetivo) => (
      tieneEnvioResultadoValido(objetivo) || (objetivo.enviosAuditoria && objetivo.enviosAuditoria.length > 0)
    )).length;
    const base = objetivosArea[0];
    return {
      areaId,
      codigo: base?.codigoAreaSnapshot ?? '',
      nombre: base?.nombreAreaSnapshot ?? '',
      tipoArea: base?.tipoAreaSnapshot ?? filtros.tipoArea,
      tieneResultado: periodosRealizados > 0,
      porcentaje: porcentajes.length ? promedio(porcentajes) : null,
      resultado5SMensual: porcentajes.length ? promedio(porcentajes) : null,
      periodosProgramados,
      periodosRealizados,
      cumplimientoPeriodos: periodosProgramados ? (periodosRealizados / periodosProgramados) * 100 : 0,
      posicion: null,
      puedeVerDetalle: areaIdsDetalle === null || areaIdsDetalle.includes(areaId),
      ...(esAdmin
        ? {
            detallePeriodos: objetivosArea.map((objetivo) => ({
              ...construirDetalleAdminPeriodo(objetivo),
              envioResultadoId: objetivo.envioResultadoId,
              envios: objetivo.enviosAuditoria || [],
            })),
          }
        : {
            periodos: objetivosArea.map((objetivo) => ({
              ...construirDetalleAuditorPeriodo(objetivo),
              envioResultadoId: objetivo.envioResultadoId,
              envios: objetivo.enviosAuditoria || [],
            })),
          }),
    };
  })
    .sort((a, b) => (b.porcentaje ?? -1) - (a.porcentaje ?? -1))
    .map((area, index) => ({ ...area, posicion: area.porcentaje === null ? null : index + 1 }));

  const porcentajesResultados = areas.flatMap((area) => (area.resultado5SMensual === null ? [] : [area.resultado5SMensual]));
  const periodosProgramados = areas.reduce((total, area) => total + area.periodosProgramados, 0);
  const periodosRealizados = areas.reduce((total, area) => total + area.periodosRealizados, 0);

  responder(res, {
    areas,
    promedio: porcentajesResultados.length ? promedio(porcentajesResultados) : null,
    resultado5SMensual: porcentajesResultados.length ? promedio(porcentajesResultados) : null,
    periodosProgramados,
    periodosRealizados,
    cumplimientoPeriodos: periodosProgramados ? (periodosRealizados / periodosProgramados) * 100 : 0,
    ganadores: calcularGanadores(areas),
  });
};
