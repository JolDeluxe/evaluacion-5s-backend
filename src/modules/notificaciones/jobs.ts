import cron from 'node-cron';
import { env } from '../../config/env';
import { prisma } from '../../db';
import { EstadoAsignacionAuditoria, TipoNotificacion } from '../../generated/prisma/enums';
import { calcularCierreConGracia, tieneEnvioResultadoValido } from '../../utils/periodos';
import { crearNotificacionUsuario } from './helper';
import { procesarEntregasPendientes } from './worker';

export const iniciarJobsNotificaciones = () => {
  if (!env.NOTIFICACIONES_WORKER_ENABLED) return [];
  const tareas = [
    cron.schedule(env.NOTIFICACIONES_WORKER_CRON, () => {
      procesarEntregasPendientes().catch(() => undefined);
    }),
    cron.schedule('*/5 * * * *', () => {
      actualizarAsignacionesVencidas().catch(() => undefined);
    }),
    cron.schedule('*/30 * * * *', () => {
      generarNotificacionesPeriodos().catch(() => undefined);
    }),
  ];
  return tareas;
};

const actualizarAsignacionesVencidas = async () => {
  const ahora = new Date();
  const asignaciones = await prisma.asignacionAuditoria.findMany({
    where: { estado: { in: [EstadoAsignacionAuditoria.PENDIENTE, EstadoAsignacionAuditoria.EN_PROCESO] }, completadoEn: null },
    include: {
      objetivoAuditoria: {
        include: { envioResultado: true },
      },
    },
  });

  for (const asignacion of asignaciones) {
    const objetivo = asignacion.objetivoAuditoria;
    if (tieneEnvioResultadoValido(objetivo)) continue;
    if (ahora <= calcularCierreConGracia(objetivo.terminaEn)) continue;
    if (asignacion.reabiertaHasta && ahora <= asignacion.reabiertaHasta) continue;
    await prisma.asignacionAuditoria.update({
      where: { id: asignacion.id },
      data: { estado: EstadoAsignacionAuditoria.VENCIDA },
    });
  }
};

const fechaDedupe = (fecha: Date) => fecha.toISOString().slice(0, 10);

const generarNotificacionesPeriodos = async () => {
  const ahora = new Date();
  const asignaciones = await prisma.asignacionAuditoria.findMany({
    where: {
      estado: { in: [EstadoAsignacionAuditoria.PENDIENTE, EstadoAsignacionAuditoria.EN_PROCESO] },
      completadoEn: null,
    },
    include: {
      auditor: { select: { id: true, correo: true } },
      objetivoAuditoria: {
        include: { envioResultado: true },
      },
    },
  });

  await prisma.$transaction(async (tx) => {
    for (const asignacion of asignaciones) {
      const objetivo = asignacion.objetivoAuditoria;
      if (tieneEnvioResultadoValido(objetivo)) continue;

      const cierreGracia = calcularCierreConGracia(objetivo.terminaEn);
      if (ahora > objetivo.terminaEn && ahora <= cierreGracia) {
        await crearNotificacionUsuario(tx, {
          usuario: asignacion.auditor,
          claveDedupe: `recordatorio-periodo:${asignacion.id}:${fechaDedupe(ahora)}`,
          tipo: TipoNotificacion.RECORDATORIO,
          titulo: 'Auditoria pendiente',
          mensaje: `Tienes pendiente la auditoria del periodo ${objetivo.periodo} de ${objetivo.nombreAreaSnapshot}.`,
          ruta: `/auditorias/asignaciones/${asignacion.id}`,
        });
      }

      if (ahora > cierreGracia) {
        await crearNotificacionUsuario(tx, {
          usuario: asignacion.auditor,
          claveDedupe: `auditoria-vencida:${asignacion.id}`,
          tipo: TipoNotificacion.AUDITORIA_VENCIDA,
          titulo: 'Auditoria cerrada',
          mensaje: `El periodo ${objetivo.periodo} de ${objetivo.nombreAreaSnapshot} ya cerro.`,
          ruta: `/auditorias/asignaciones/${asignacion.id}`,
        });
      }
    }
  });
};
