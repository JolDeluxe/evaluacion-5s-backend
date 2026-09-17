import type { Request, Response } from 'express';
import { prisma } from '../../db';
import { responder } from '../../utils/respuesta';
import { calcularCumplimientoUsuarioEnMemoria } from './servicio_kpi';
import { esquemaParamUsuarioId, esquemaQueryCumplimientos } from './zod';

export const obtenerCumplimientoUsuario = async (req: Request, res: Response) => {
  const { id } = esquemaParamUsuarioId.parse(req.params);
  const query = esquemaQueryCumplimientos.parse(req.query);
  const ahora = new Date();

  const anio = query.anio ?? ahora.getFullYear();
  const mes = query.mes ?? (ahora.getMonth() + 1);

  const datos = await prisma.cumplimientoMensualUsuario.findUnique({
    where: {
      usuarioId_anio_mes: {
        usuarioId: id,
        anio,
        mes,
      },
    },
    include: {
      usuario: {
        select: {
          id: true,
          nombre: true,
          nombreUsuario: true,
          correo: true,
          rol: true,
          seEvalua: true,
          esComodin: true,
        },
      },
      detallesAreas: true,
    },
  });

  if (!datos) {
    const enMemoria = await calcularCumplimientoUsuarioEnMemoria(prisma, id, anio, mes, false, ahora);
    responder(res, {
      id: null,
      usuarioId: enMemoria.usuarioId,
      anio: enMemoria.anio,
      mes: enMemoria.mes,
      seEvaluaSnapshot: enMemoria.seEvaluaSnapshot,
      auditoriasEsperadas: enMemoria.auditoriasEsperadas,
      auditoriasATiempo: enMemoria.auditoriasATiempo,
      porcentajeCumplimiento: enMemoria.porcentajeCumplimiento,
      promedioAreas: enMemoria.promedioAreas,
      areasConResultado: enMemoria.areasConResultado,
      kpiFinal: enMemoria.kpiFinal,
      calculadoEn: enMemoria.calculadoEn,
      usuario: enMemoria.usuario,
      detallesAreas: enMemoria.detallesAreas.map((d) => ({
        areaId: d.areaId,
        codigoAreaSnapshot: d.codigoAreaSnapshot,
        nombreAreaSnapshot: d.nombreAreaSnapshot,
        tipoAreaSnapshot: d.tipoAreaSnapshot,
        resultadoMensualUtilizado: d.resultadoMensualUtilizado,
      })),
    });
    return;
  }

  responder(res, datos);
};
