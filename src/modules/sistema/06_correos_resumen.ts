import type { Request, Response } from 'express';
import { prisma } from '../../db';
import { CanalNotificacion, EstadoEntregaNotificacion, TipoNotificacion } from '../../generated/prisma/enums';
import { responder } from '../../utils/respuesta';

export const resumenCorreosSistema = async (_req: Request, res: Response) => {
  const ahora = new Date();
  const hace24h = new Date(ahora.getTime() - 24 * 60 * 60 * 1000);
  const hace7d = new Date(ahora.getTime() - 7 * 24 * 60 * 60 * 1000);
  const hace30d = new Date(ahora.getTime() - 30 * 24 * 60 * 60 * 1000);

  const [
    totalEntregasCorreo,
    pendientes,
    enviadas,
    fallidas,
    canceladas,
    procesando,
    enviadas24h,
    enviadas7d,
    enviadas30d,
    asignacionesMensuales,
    resultadosMensuales,
    otrasNotificaciones,
    ultimaEnviada,
  ] = await prisma.$transaction([
    prisma.entregaNotificacion.count({ where: { canal: CanalNotificacion.CORREO } }),
    prisma.entregaNotificacion.count({ where: { canal: CanalNotificacion.CORREO, estado: EstadoEntregaNotificacion.PENDIENTE } }),
    prisma.entregaNotificacion.count({ where: { canal: CanalNotificacion.CORREO, estado: EstadoEntregaNotificacion.ENVIADA } }),
    prisma.entregaNotificacion.count({ where: { canal: CanalNotificacion.CORREO, estado: EstadoEntregaNotificacion.FALLIDA } }),
    prisma.entregaNotificacion.count({ where: { canal: CanalNotificacion.CORREO, estado: EstadoEntregaNotificacion.CANCELADA } }),
    prisma.entregaNotificacion.count({ where: { canal: CanalNotificacion.CORREO, estado: EstadoEntregaNotificacion.PROCESANDO } }),
    prisma.entregaNotificacion.count({ where: { canal: CanalNotificacion.CORREO, estado: EstadoEntregaNotificacion.ENVIADA, enviadoEn: { gte: hace24h } } }),
    prisma.entregaNotificacion.count({ where: { canal: CanalNotificacion.CORREO, estado: EstadoEntregaNotificacion.ENVIADA, enviadoEn: { gte: hace7d } } }),
    prisma.entregaNotificacion.count({ where: { canal: CanalNotificacion.CORREO, estado: EstadoEntregaNotificacion.ENVIADA, enviadoEn: { gte: hace30d } } }),
    prisma.entregaNotificacion.count({ where: { canal: CanalNotificacion.CORREO, notificacion: { tipo: TipoNotificacion.ASIGNACION_MENSUAL_CORREO } } }),
    prisma.entregaNotificacion.count({ where: { canal: CanalNotificacion.CORREO, notificacion: { tipo: TipoNotificacion.RESULTADO_MENSUAL_CORREO } } }),
    prisma.entregaNotificacion.count({
      where: {
        canal: CanalNotificacion.CORREO,
        notificacion: {
          tipo: {
            notIn: [TipoNotificacion.ASIGNACION_MENSUAL_CORREO, TipoNotificacion.RESULTADO_MENSUAL_CORREO],
          },
        },
      },
    }),
    prisma.entregaNotificacion.findFirst({
      where: { canal: CanalNotificacion.CORREO, estado: EstadoEntregaNotificacion.ENVIADA },
      orderBy: { enviadoEn: 'desc' },
      select: { enviadoEn: true, destinoSnapshot: true },
    }),
  ]);

  responder(res, {
    resumen: {
      totales: {
        total: totalEntregasCorreo,
        pendientes,
        enviadas,
        fallidas,
        canceladas,
        procesando,
      },
      actividad: {
        enviadasUltimas24h: enviadas24h,
        enviadasUltimos7d: enviadas7d,
        enviadasUltimos30d: enviadas30d,
        ultimaEnviadaEn: ultimaEnviada?.enviadoEn ?? null,
      },
      porTipo: {
        asignacionMensual: asignacionesMensuales,
        resultadoMensual: resultadosMensuales,
        otros: otrasNotificaciones,
      },
    },
  });
};