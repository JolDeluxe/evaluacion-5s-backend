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
  actualizadas: number;
  duplicadas: number;
  sinCorreo: number;
};

/**
 * Reconcilia de forma idempotente las obligaciones de notificación por correo
 * para las auditorías asignadas del mes.
 *
 * Reglas:
 * - Se activa cuando ahora >= primerDiaHabilMes(anio, mes).
 * - Asignaciones tardías: Un auditor asignado después del día 1 hábil recibe su correo inicial normalmente.
 * - Dedupe inicial: "asignacion-mensual-correo:{auditorId}:{YYYY-MM}".
 * - Detección de cambios: Mediante fingerprint SHA-256 de las áreas asignadas ordenadas.
 * - Consolidación: Si ya existe una entrega PENDIENTE y cambian las asignaciones, se actualiza
 *   esa misma entrega sin crear filas adicionales ni saturar la cola.
 * - Nueva versión: Si la entrega anterior ya fue ENVIADA y las asignaciones vuelven a cambiar,
 *   se genera una nueva entrega con formato de actualización.
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
    return { revisados: 0, creadas: 0, actualizadas: 0, duplicadas: 0, sinCorreo: 0 };
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
    return { revisados: 0, creadas: 0, actualizadas: 0, duplicadas: 0, sinCorreo: 0 };
  }

  const auditorIds = Array.from(asignacionesPorAuditor.keys());
  const usuarios = await tx.usuario.findMany({
    where: { id: { in: auditorIds } },
    select: { id: true, nombre: true, correo: true, activo: true },
  });

  let creadas = 0;
  let actualizadas = 0;
  let duplicadas = 0;
  let sinCorreo = 0;

  for (const usuario of usuarios) {
    if (!usuario.activo) continue;
    const datosAuditor = asignacionesPorAuditor.get(usuario.id);
    if (!datosAuditor || datosAuditor.areas.length === 0) continue;

    const areasOrdenadas = [...datosAuditor.areas].sort((a, b) => a.localeCompare(b));
    const fingerprint = hashSha256(areasOrdenadas.join('|'));

    // Buscar notificaciones previas de asignación de este usuario y mes
    const notificacionesUsuario = await tx.notificacion.findMany({
      where: {
        usuarioId: usuario.id,
        tipo: TipoNotificacion.ASIGNACION_MENSUAL_CORREO,
        OR: [
          { claveDedupe: `asignacion-mensual-correo:${usuario.id}:${yyyyMM}` },
          { claveDedupe: { startsWith: `asignacion-actualizada-correo:${usuario.id}:${yyyyMM}:` } },
        ],
      },
      orderBy: { creadoEn: 'desc' },
    });

    if (notificacionesUsuario.length === 0) {
      // 1. Asignación inicial (a tiempo o tardía)
      const claveDedupe = `asignacion-mensual-correo:${usuario.id}:${yyyyMM}`;
      const payloadDatos = {
        templateName: 'audit_assignment_monthly' as const,
        templateVersion: 'v1' as const,
        auditorNombre: usuario.nombre,
        mes: yyyyMM,
        mesEtiqueta,
        areas: areasOrdenadas,
        areasFingerprint: fingerprint,
        urlMisAuditorias: appUrl('/mis-auditorias'),
        esActualizacion: false,
      };

      const notificacion = await tx.notificacion.create({
        data: {
          usuarioId: usuario.id,
          claveDedupe,
          tipo: TipoNotificacion.ASIGNACION_MENSUAL_CORREO,
          titulo: `Auditorías asignadas — ${mesEtiqueta}`,
          mensaje: `Hola ${usuario.nombre}, tus auditorías asignadas para ${mesEtiqueta} son: ${areasOrdenadas.join(', ')}.`,
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
    } else {
      // 2. Notificaciones previas existen: evaluar si hubo cambio en las áreas
      const ultimaNotif = notificacionesUsuario[0];
      const datosUltima = (ultimaNotif.datos || {}) as Record<string, unknown>;
      const ultimoFingerprint =
        (typeof datosUltima.areasFingerprint === 'string' && datosUltima.areasFingerprint) ||
        (Array.isArray(datosUltima.areas)
          ? hashSha256([...(datosUltima.areas as string[])].sort((a, b) => a.localeCompare(b)).join('|'))
          : null);

      if (ultimoFingerprint === fingerprint) {
        // No hay cambios en la lista de áreas asignadas
        duplicadas += 1;
        continue;
      }

      // Las áreas asignadas cambiaron: buscar todas las entregas asociadas a estas notificaciones
      const notifIds = notificacionesUsuario.map((n) => n.id);
      const todasLasEntregas = await tx.entregaNotificacion.findMany({
        where: { notificacionId: { in: notifIds } },
      });

      const entregaPendiente = todasLasEntregas.find(
        (e) => e.canal === CanalNotificacion.CORREO && e.estado === EstadoEntregaNotificacion.PENDIENTE,
      );

      const yaSeEnvioPrevia = todasLasEntregas.some(
        (e) => e.canal === CanalNotificacion.CORREO && e.estado === EstadoEntregaNotificacion.ENVIADA,
      );

      if (entregaPendiente) {
        // CONSOLIDACIÓN: Ya hay una entrega PENDIENTE; actualizar la misma entrega sin crear filas adicionales
        const payloadActualizado = {
          templateName: 'audit_assignment_monthly' as const,
          templateVersion: 'v1' as const,
          auditorNombre: usuario.nombre,
          mes: yyyyMM,
          mesEtiqueta,
          areas: areasOrdenadas,
          areasFingerprint: fingerprint,
          urlMisAuditorias: appUrl('/mis-auditorias'),
          esActualizacion: yaSeEnvioPrevia,
        };

        await tx.notificacion.update({
          where: { id: entregaPendiente.notificacionId },
          data: {
            titulo: yaSeEnvioPrevia
              ? `Actualización de asignaciones — ${mesEtiqueta}`
              : `Auditorías asignadas — ${mesEtiqueta}`,
            mensaje: yaSeEnvioPrevia
              ? `Hola ${usuario.nombre}, se han actualizado tus auditorías asignadas para ${mesEtiqueta}: ${areasOrdenadas.join(', ')}.`
              : `Hola ${usuario.nombre}, tus auditorías asignadas para ${mesEtiqueta} son: ${areasOrdenadas.join(', ')}.`,
            datos: payloadActualizado,
          },
        });

        const correoNormalizado = normalizarCorreo(usuario.correo);
        await tx.entregaNotificacion.update({
          where: { id: entregaPendiente.id },
          data: {
            programadoEn: ahora,
            destinoSnapshot: correoNormalizado || entregaPendiente.destinoSnapshot,
            destinoHash: correoNormalizado ? hashSha256(correoNormalizado) : entregaPendiente.destinoHash,
            ultimoError: null,
          },
        });
        actualizadas += 1;
      } else {
        // La entrega previa ya fue ENVIADA (o CANCELADA). Generar una nueva notificación de actualización
        const claveDedupe = `asignacion-actualizada-correo:${usuario.id}:${yyyyMM}:${fingerprint.slice(0, 12)}`;
        const yaExisteClave = await tx.notificacion.findUnique({ where: { claveDedupe } });
        if (yaExisteClave) {
          duplicadas += 1;
          continue;
        }

        const payloadDatos = {
          templateName: 'audit_assignment_monthly' as const,
          templateVersion: 'v1' as const,
          auditorNombre: usuario.nombre,
          mes: yyyyMM,
          mesEtiqueta,
          areas: areasOrdenadas,
          areasFingerprint: fingerprint,
          urlMisAuditorias: appUrl('/mis-auditorias'),
          esActualizacion: true,
        };

        const notificacion = await tx.notificacion.create({
          data: {
            usuarioId: usuario.id,
            claveDedupe,
            tipo: TipoNotificacion.ASIGNACION_MENSUAL_CORREO,
            titulo: `Actualización de asignaciones — ${mesEtiqueta}`,
            mensaje: `Hola ${usuario.nombre}, se han actualizado tus auditorías asignadas para ${mesEtiqueta}: ${areasOrdenadas.join(', ')}.`,
            ruta: '/mis-auditorias',
            datos: payloadDatos,
          },
        });

        const correoNormalizado = normalizarCorreo(usuario.correo);
        if (correoNormalizado) {
          await tx.entregaNotificacion.create({
            data: {
              notificacionId: notificacion.id,
              canal: CanalNotificacion.CORREO,
              estado: EstadoEntregaNotificacion.PENDIENTE,
              destinoSnapshot: correoNormalizado,
              destinoHash: hashSha256(correoNormalizado),
              programadoEn: ahora,
            },
          });
          creadas += 1;
        } else {
          await tx.entregaNotificacion.create({
            data: {
              notificacionId: notificacion.id,
              canal: CanalNotificacion.CORREO,
              estado: EstadoEntregaNotificacion.CANCELADA,
              destinoSnapshot: 'sin-correo',
              destinoHash: hashSha256(`sin-correo:${usuario.id}`),
              ultimoError: 'El usuario no tiene correo electrónico registrado.',
              programadoEn: ahora,
            },
          });
          sinCorreo += 1;
        }
      }
    }
  }

  return {
    revisados: usuarios.length,
    creadas,
    actualizadas,
    duplicadas,
    sinCorreo,
  };
};