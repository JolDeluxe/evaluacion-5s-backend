import type { PrismaTransaction } from '../../db';
import { prisma } from '../../db';
import {
  CanalNotificacion,
  EstadoEntregaNotificacion,
  TipoNotificacion,
} from '../../generated/prisma/enums';
import { hashSha256, normalizarCorreo } from '../../utils/crypto';
import { MESES_NOMBRES, primerDiaHabilMes } from '../../utils/periodos';
import { appUrl } from '../../utils/app-urls';
import { obtenerVistaMensual } from '../asignaciones/programacion_mensual';

export type ResultadoReconciliacionAsignaciones = {
  revisados: number;
  creadas: number;
  duplicadas: number;
  sinCorreo: number;
};

/**
 * Reconcilia de forma idempotente las obligaciones de notificación por correo
 * para las auditorías asignadas del mes.
 *
 * Regla:
 * - Se activa cuando ahora >= primerDiaHabilMes(anio, mes).
 * - Recupera pendientes aunque el backend haya estado apagado el día 1 hábil.
 * - Idempotente por claveDedupe = "asignacion-mensual-correo:{auditorId}:{YYYY-MM}".
 * - Agrupa todas las áreas del auditor en un solo correo consolidado.
 */
export const reconciliarAsignaciones = async (
  tx: PrismaTransaction | typeof prisma = prisma,
  targetAnio?: number,
  targetMes?: number,
  ahora = new Date(),
): Promise<ResultadoReconciliacionAsignaciones> => {
  const anio = targetAnio ?? ahora.getFullYear();
  const mes = targetMes ?? ahora.getMonth() + 1;

  const primerDiaHabil = primerDiaHabilMes(anio, mes);
  if (ahora < primerDiaHabil) {
    return { revisados: 0, creadas: 0, duplicadas: 0, sinCorreo: 0 };
  }

  const vista = await obtenerVistaMensual(tx as PrismaTransaction, anio, mes);
  const yyyyMM = `${anio}-${String(mes).padStart(2, '0')}`;
  const mesEtiqueta = `${MESES_NOMBRES[mes - 1]} ${anio}`;

  // Agrupar áreas por auditor asignado
  const asignacionesPorAuditor = new Map<
    number,
    { auditorId: number; nombre: string; areas: string[] }
  >();

  for (const fila of vista.filas) {
    if (!fila.auditorMensual) continue;
    const auditorId = fila.auditorMensual.id;
    const actual = asignacionesPorAuditor.get(auditorId) ?? {
      auditorId,
      nombre: fila.auditorMensual.nombre,
      areas: [],
    };
    if (fila.area.nombre && !actual.areas.includes(fila.area.nombre)) {
      actual.areas.push(fila.area.nombre);
    }
    asignacionesPorAuditor.set(auditorId, actual);
  }

  if (asignacionesPorAuditor.size === 0) {
    return { revisados: 0, creadas: 0, duplicadas: 0, sinCorreo: 0 };
  }

  const auditorIds = Array.from(asignacionesPorAuditor.keys());
  const usuarios = await tx.usuario.findMany({
    where: { id: { in: auditorIds } },
    select: { id: true, nombre: true, correo: true, activo: true },
  });

  let creadas = 0;
  let duplicadas = 0;
  let sinCorreo = 0;

  for (const usuario of usuarios) {
    if (!usuario.activo) continue;
    const datosAuditor = asignacionesPorAuditor.get(usuario.id);
    if (!datosAuditor || datosAuditor.areas.length === 0) continue;

    const claveDedupe = `asignacion-mensual-correo:${usuario.id}:${yyyyMM}`;

    const existente = await tx.notificacion.findUnique({
      where: { claveDedupe },
    });

    if (existente) {
      duplicadas += 1;
      continue;
    }

    const payloadDatos = {
      templateName: 'audit_assignment_monthly' as const,
      templateVersion: 'v1' as const,
      auditorNombre: usuario.nombre,
      mes: yyyyMM,
      mesEtiqueta,
      areas: datosAuditor.areas,
      urlMisAuditorias: appUrl('/mis-auditorias'),
    };

    const notificacion = await tx.notificacion.create({
      data: {
        usuarioId: usuario.id,
        claveDedupe,
        tipo: TipoNotificacion.ASIGNACION_MENSUAL_CORREO,
        titulo: `Auditorías asignadas — ${mesEtiqueta}`,
        mensaje: `Hola ${usuario.nombre}, tus auditorías asignadas para ${mesEtiqueta} son: ${datosAuditor.areas.join(', ')}.`,
        ruta: '/mis-auditorias',
        datos: payloadDatos,
      },
    });

    const correoNormalizado = normalizarCorreo(usuario.correo);
    if (correoNormalizado) {
      const destinoHash = hashSha256(correoNormalizado);
      await tx.entregaNotificacion.create({
        data: {
          notificacionId: notificacion.id,
          canal: CanalNotificacion.CORREO,
          estado: EstadoEntregaNotificacion.PENDIENTE,
          destinoSnapshot: correoNormalizado,
          destinoHash,
          programadoEn: ahora,
        },
      });
      creadas += 1;
    } else {
      const dummyHash = hashSha256(`sin-correo:${usuario.id}`);
      await tx.entregaNotificacion.create({
        data: {
          notificacionId: notificacion.id,
          canal: CanalNotificacion.CORREO,
          estado: EstadoEntregaNotificacion.CANCELADA,
          destinoSnapshot: 'sin-correo',
          destinoHash: dummyHash,
          ultimoError: 'El usuario no tiene correo electrónico registrado.',
          programadoEn: ahora,
        },
      });
      sinCorreo += 1;
    }
  }

  return {
    revisados: usuarios.length,
    creadas,
    duplicadas,
    sinCorreo,
  };
};