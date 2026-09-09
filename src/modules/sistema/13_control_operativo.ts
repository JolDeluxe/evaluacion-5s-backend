import type { Request, Response } from 'express';
import { z } from 'zod';
import { env } from '../../config/env';
import { prisma } from '../../db';
import { CanalNotificacion, EstadoEntregaNotificacion, TipoNotificacion } from '../../generated/prisma/enums';
import { conflicto, solicitudInvalida } from '../../utils/errores';
import { responder } from '../../utils/respuesta';
import {
  actualizarEstadoControlOperativo,
  obtenerEstadoControlOperativo,
} from '../notificaciones/control-operativo';
import { registrarAuditoria } from '../registros_auditoria/helper';

export const obtenerControlOperativoSistema = async (_req: Request, res: Response) => {
  const infoControl = await obtenerEstadoControlOperativo();

  // Obtener usuario que actualizó si existe
  let usuarioActualizo: { id: number; nombre: string; correo: string | null } | null = null;
  if (infoControl.actualizadoPorId) {
    usuarioActualizo = await prisma.usuario.findUnique({
      where: { id: infoControl.actualizadoPorId },
      select: { id: true, nombre: true, correo: true },
    });
  }

  // Métricas de Preflight
  const [
    pendientes,
    fallidas,
    procesando,
    enviadas,
    canceladas,
    pendientesAsignaciones,
    pendientesRecordatorios,
    pendientesResultados,
    pendientesOtros,
    pendientesExampleTest,
    usuariosSinCorreo,
  ] = await prisma.$transaction([
    prisma.entregaNotificacion.count({
      where: { canal: CanalNotificacion.CORREO, estado: EstadoEntregaNotificacion.PENDIENTE },
    }),
    prisma.entregaNotificacion.count({
      where: { canal: CanalNotificacion.CORREO, estado: EstadoEntregaNotificacion.FALLIDA },
    }),
    prisma.entregaNotificacion.count({
      where: { canal: CanalNotificacion.CORREO, estado: EstadoEntregaNotificacion.PROCESANDO },
    }),
    prisma.entregaNotificacion.count({
      where: { canal: CanalNotificacion.CORREO, estado: EstadoEntregaNotificacion.ENVIADA },
    }),
    prisma.entregaNotificacion.count({
      where: { canal: CanalNotificacion.CORREO, estado: EstadoEntregaNotificacion.CANCELADA },
    }),
    prisma.entregaNotificacion.count({
      where: {
        canal: CanalNotificacion.CORREO,
        estado: EstadoEntregaNotificacion.PENDIENTE,
        notificacion: { tipo: TipoNotificacion.ASIGNACION_MENSUAL_CORREO },
      },
    }),
    prisma.entregaNotificacion.count({
      where: {
        canal: CanalNotificacion.CORREO,
        estado: EstadoEntregaNotificacion.PENDIENTE,
        notificacion: { tipo: TipoNotificacion.RECORDATORIO },
      },
    }),
    prisma.entregaNotificacion.count({
      where: {
        canal: CanalNotificacion.CORREO,
        estado: EstadoEntregaNotificacion.PENDIENTE,
        notificacion: { tipo: TipoNotificacion.RESULTADO_MENSUAL_CORREO },
      },
    }),
    prisma.entregaNotificacion.count({
      where: {
        canal: CanalNotificacion.CORREO,
        estado: EstadoEntregaNotificacion.PENDIENTE,
        notificacion: {
          tipo: {
            notIn: [
              TipoNotificacion.ASIGNACION_MENSUAL_CORREO,
              TipoNotificacion.RECORDATORIO,
              TipoNotificacion.RESULTADO_MENSUAL_CORREO,
            ],
          },
        },
      },
    }),
    prisma.entregaNotificacion.count({
      where: {
        canal: CanalNotificacion.CORREO,
        estado: EstadoEntregaNotificacion.PENDIENTE,
        destinoSnapshot: { contains: 'example.test' },
      },
    }),
    prisma.usuario.count({
      where: {
        activo: true,
        OR: [{ correo: null }, { correo: '' }, { correo: 'sin-correo' }],
      },
    }),
  ]);

  responder(res, {
    controlOperativo: {
      estado: infoControl.estado,
      actualizadoEn: infoControl.actualizadoEn ?? null,
      actualizadoPor: usuarioActualizo,
      motivo: infoControl.motivo ?? null,
      emailEnabled: env.EMAIL_ENABLED,
      emailTestEnabled: env.EMAIL_TEST_ENABLED,
      smtpHabilitado: env.SMTP_ENABLED,
      preflight: {
        pendientes,
        fallidas,
        procesando,
        enviadas,
        canceladas,
        pendientesPorTipo: {
          asignaciones: pendientesAsignaciones,
          recordatorios: pendientesRecordatorios,
          resultados: pendientesResultados,
          otros: pendientesOtros,
        },
        pendientesExampleTest,
        bloqueadoPorPruebas: pendientesExampleTest > 0,
        usuariosSinCorreo,
      },
    },
  });
};

const esquemaPausar = z.object({
  motivo: z.string().trim().max(300).optional(),
});

export const pausarCorreosSistema = async (req: Request, res: Response) => {
  const usuarioId = req.autenticacion?.usuarioId;
  if (!usuarioId) throw solicitudInvalida('Usuario no autenticado');

  const { motivo } = esquemaPausar.parse(req.body);

  const anterior = await obtenerEstadoControlOperativo();
  const actualizado = await actualizarEstadoControlOperativo(
    'PAUSADO',
    usuarioId,
    motivo || 'Pausa manual desde Sistema -> Entregas',
  );

  await registrarAuditoria({
    usuarioId,
    accion: 'PAUSAR_CORREOS',
    tipoEntidad: 'ControlOperativoCorreos',
    idEntidad: 0,
    datosAnteriores: anterior,
    datosNuevos: actualizado,
  });

  responder(res, {
    mensaje: 'El despacho de correos automáticos ha sido PAUSADO.',
    controlOperativo: actualizado,
  });
};

const esquemaReanudar = z.object({
  motivo: z.string().trim().max(300).optional(),
});

export const reanudarCorreosSistema = async (req: Request, res: Response) => {
  const usuarioId = req.autenticacion?.usuarioId;
  if (!usuarioId) throw solicitudInvalida('Usuario no autenticado');

  const { motivo } = esquemaReanudar.parse(req.body);

  // Bloqueo preventivo: Validar que no existan entregas PENDIENTE con destino @example.test
  const pendientesExampleTest = await prisma.entregaNotificacion.count({
    where: {
      canal: CanalNotificacion.CORREO,
      estado: EstadoEntregaNotificacion.PENDIENTE,
      destinoSnapshot: { contains: 'example.test' },
    },
  });

  if (pendientesExampleTest > 0) {
    throw conflicto(
      `No es posible reanudar los envíos automáticos porque existen ${pendientesExampleTest} entregas pendientes dirigidas a dominios de prueba (@example.test). Cancela estas entregas desde la tabla antes de reanudar el sistema.`
    );
  }

  const anterior = await obtenerEstadoControlOperativo();
  const actualizado = await actualizarEstadoControlOperativo(
    'ACTIVO',
    usuarioId,
    motivo || 'Reanudación manual desde Sistema -> Entregas',
  );

  await registrarAuditoria({
    usuarioId,
    accion: 'REANUDAR_CORREOS',
    tipoEntidad: 'ControlOperativoCorreos',
    idEntidad: 0,
    datosAnteriores: anterior,
    datosNuevos: actualizado,
  });

  responder(res, {
    mensaje: 'El despacho de correos automáticos ha sido ACTIVADO.',
    controlOperativo: actualizado,
  });
};
