import type { Request, Response } from 'express';
import { prisma } from '../../db';
import { responder } from '../../utils/respuesta';
import { calcularYGuardarCumplimientoUsuario } from './servicio_kpi';
import { esquemaParamUsuarioId, esquemaQueryCumplimientos } from './zod';

export const obtenerCumplimientoUsuario = async (req: Request, res: Response) => {
  const { id } = esquemaParamUsuarioId.parse(req.params);
  const query = esquemaQueryCumplimientos.parse(req.query);
  const ahora = new Date();

  const anio = query.anio ?? ahora.getFullYear();
  const mes = query.mes ?? (ahora.getMonth() + 1);

  let datos = await prisma.cumplimientoMensualUsuario.findUnique({
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
    await calcularYGuardarCumplimientoUsuario(prisma, id, anio, mes);
    datos = await prisma.cumplimientoMensualUsuario.findUnique({
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
  }

  responder(res, datos);
};
