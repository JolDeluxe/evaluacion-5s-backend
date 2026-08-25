import type { Request, Response } from 'express';
import { prisma } from '../../db';
import { TipoArea } from '../../generated/prisma/enums';
import { tieneEnvioResultadoValido } from '../../utils/periodos';
import { responder } from '../../utils/respuesta';
import { calcularGanadores, construirWhereCiclo, promedio } from './helper';
import { esquemaFiltros } from './zod';

export const resumenResultados = async (req: Request, res: Response) => {
  const filtros = esquemaFiltros.parse(req.query);
  const objetivos = await prisma.objetivoAuditoria.findMany({
    where: {
      tipoAreaSnapshot: filtros.tipoArea,
      cicloAuditoria: construirWhereCiclo(filtros),
    },
    include: {
      envioResultado: true,
      cicloAuditoria: true,
      enviosAuditoria: {
        where: { invalidadoEn: null },
        orderBy: [{ recibidoEn: 'asc' }, { id: 'asc' }],
      },
    },
  });
  const areas = objetivos.map((objetivo) => ({
    areaId: objetivo.areaId,
    codigo: objetivo.codigoAreaSnapshot,
    nombre: objetivo.nombreAreaSnapshot,
    tipoArea: objetivo.tipoAreaSnapshot,
    porcentaje: tieneEnvioResultadoValido(objetivo) ? Number(objetivo.envioResultado?.porcentaje ?? 0) : null,
  }));
  const oficiales = objetivos.filter(tieneEnvioResultadoValido);
  const realizadas = objetivos.filter(
    (obj) => tieneEnvioResultadoValido(obj) || (obj.enviosAuditoria && obj.enviosAuditoria.length > 0)
  );
  const porcentajes = oficiales.map((objetivo) => Number(objetivo.envioResultado?.porcentaje ?? 0));
  const administrativos = areas.filter((objetivo) => objetivo.tipoArea === TipoArea.ADMINISTRATIVA);
  const operativos = areas.filter((objetivo) => objetivo.tipoArea === TipoArea.OPERATIVA);
  responder(res, {
    totalObjetivos: objetivos.length,
    objetivosConOficial: oficiales.length,
    periodosProgramados: objetivos.length,
    periodosRealizados: realizadas.length,
    cumplimientoPeriodos: objetivos.length ? (realizadas.length / objetivos.length) * 100 : 0,
    resultado5SMensual: porcentajes.length ? promedio(porcentajes) : null,
    cobertura: {
      completadas: realizadas.length,
      total: objetivos.length,
      porcentaje: objetivos.length ? (realizadas.length / objetivos.length) * 100 : 0,
    },
    resultadoGlobal: promedio(porcentajes),
    resultadoAdministrativo: promedio(administrativos.flatMap((area) => (area.porcentaje === null ? [] : [area.porcentaje]))),
    resultadoOperativo: promedio(operativos.flatMap((area) => (area.porcentaje === null ? [] : [area.porcentaje]))),
    ganadores: {
      administrativo: calcularGanadores(administrativos),
      operativo: calcularGanadores(operativos),
    },
  });
};
