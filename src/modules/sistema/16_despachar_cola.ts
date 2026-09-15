import type { Request, Response } from 'express';
import { procesarEntregasPendientes } from '../notificaciones/worker';
import { responder } from '../../utils/respuesta';
import { prisma } from '../../db';
import { EstadoEntregaNotificacion } from '../../generated/prisma/enums';

/**
 * Despacha inmediatamente todas las entregas elegibles en cola (PENDIENTE / FALLIDA reintentable),
 * sin necesidad de esperar al siguiente ciclo del cron del worker en segundo plano.
 */
export const despacharColaSistema = async (_req: Request, res: Response) => {
  const antes = await prisma.entregaNotificacion.count({
    where: { estado: EstadoEntregaNotificacion.PENDIENTE },
  });

  const resultado = await procesarEntregasPendientes();

  const despues = await prisma.entregaNotificacion.count({
    where: { estado: EstadoEntregaNotificacion.PENDIENTE },
  });

  return responder(res, {
    mensaje: 'Despacho de cola ejecutado bajo demanda.',
    pendientesAntes: antes,
    pendientesDespues: despues,
    procesadas: resultado?.procesadas ?? Math.max(0, antes - despues),
  }, 200);
};
