import type { PrismaTransaction } from '../../db';
import { prisma } from '../../db';
import {
  CanalNotificacion,
  EstadoAsignacionAuditoria,
  EstadoEntregaNotificacion,
  TipoNotificacion,
} from '../../generated/prisma/enums';
import { hashSha256, normalizarCorreo } from '../../utils/crypto';
import {
  evaluarVentanaRecordatorioPeriodo,
  MESES_NOMBRES,
  obtenerUltimoDiaHabilPeriodo,
  tieneEnvioResultadoValido,
} from '../../utils/periodos';
import { appUrl } from '../../utils/app-urls';

export type ResultadoReconciliacionRecordatorios = {
  revisados: number;
  creadas: number;
  duplicadas: number;
  sinCorreo: number;
  fechaRecordatorio: string;
  esElegible: boolean;
  esObsoleto: boolean;
  motivo: string;
};

/**
 * Reconcilia de forma consolidada e idempotente las obligaciones de notificación
 * por correo para los recordatorios de auditorías pendientes por periodo (P1 y P2).
 *
 * Reglas:
 * - P1: Último día hábil <= día 15 del mes.
 * - P2: Último día hábil <= fin de mes.
 * - Horario: Ejecutable a partir de las 09:00 AM (hora America/Mexico_City).
 * - Ventana estricta: Solo en la fecha exacta del recordatorio. Si el día ya pasó,
 *   NO se envían recordatorios obsoletos.
 * - Destinatarios: Solo auditores con al menos 1 auditoría pendiente en ese periodo.
 * - Consolidación: 1 correo por auditor con lista de áreas pendientes.
 * - Dedupe: "recordatorio-periodo-correo:{auditorId}:{YYYY-MM}:P{periodo}".
 * - Tipo: TipoNotificacion.RECORDATORIO.
 */
export const reconciliarRecordatoriosPeriodo = async (
  tx: PrismaTransaction | typeof prisma = prisma,
  periodo: 1 | 2,
  targetAnio?: number,
  targetMes?: number,
  ahora = new Date(),
  forzarPorPrueba = false,
): Promise<ResultadoReconciliacionRecordatorios> => {
  const anio = targetAnio ?? ahora.getFullYear();
  const mes = targetMes ?? ahora.getMonth() + 1;
  const yyyyMM = `${anio}-${String(mes).padStart(2, '0')}`;
  const mesEtiqueta = `${MESES_NOMBRES[mes - 1]} ${anio}`;

  const diasInhabiles = tx.diaInhabil?.findMany
    ? await tx.diaInhabil.findMany({ select: { fecha: true } })
    : [];
  const diasInhabilesSet = new Set(
    diasInhabiles.map((d) => {
      const f = new Date(d.fecha);
      return `${f.getUTCFullYear()}-${String(f.getUTCMonth() + 1).padStart(2, '0')}-${String(f.getUTCDate()).padStart(2, '0')}`;
    }),
  );

  const fechaRecordatorio = obtenerUltimoDiaHabilPeriodo(anio, mes, periodo, diasInhabilesSet);
  const fechaRecordatorioStr = `${fechaRecordatorio.getFullYear()}-${String(fechaRecordatorio.getMonth() + 1).padStart(2, '0')}-${String(fechaRecordatorio.getDate()).padStart(2, '0')}`;
  const fechaLimiteTexto = `${fechaRecordatorio.getDate()} de ${MESES_NOMBRES[mes - 1]} de ${anio}`;

  const ventana = evaluarVentanaRecordatorioPeriodo(fechaRecordatorio, ahora);

  if (!ventana.esElegible && !forzarPorPrueba) {
    return {
      revisados: 0,
      creadas: 0,
      duplicadas: 0,
      sinCorreo: 0,
      fechaRecordatorio: fechaRecordatorioStr,
      esElegible: ventana.esElegible,
      esObsoleto: ventana.esObsoleto,
      motivo: ventana.motivo,
    };
  }

  // 1. Buscar asignaciones activas pendientes en ese periodo
  const asignaciones = await tx.asignacionAuditoria.findMany({
    where: {
      estado: {
        in: [EstadoAsignacionAuditoria.PENDIENTE, EstadoAsignacionAuditoria.EN_PROCESO],
      },
      completadoEn: null,
      objetivoAuditoria: {
        anio,
        mes,
        periodo,
        canceladoEn: null,
      },
    },
    include: {
      auditor: {
        select: { id: true, nombre: true, correo: true, activo: true },
      },
      objetivoAuditoria: {
        include: {
          envioResultado: true,
          enviosAuditoria: true,
          area: { select: { id: true, nombre: true } },
        },
      },
    },
  });

  // 2. Filtrar únicamente las que no tienen envío verificado válido y agrupar por auditor
  const porAuditor = new Map<
    number,
    {
      auditor: { id: number; nombre: string; correo: string | null; activo: boolean };
      areas: string[];
    }
  >();

  for (const asig of asignaciones) {
    if (!asig.auditor.activo) continue;
    if (tieneEnvioResultadoValido(asig.objetivoAuditoria)) continue;

    const auditorId = asig.auditor.id;
    const actual = porAuditor.get(auditorId) ?? {
      auditor: asig.auditor,
      areas: [],
    };

    const nombreArea = asig.objetivoAuditoria.area?.nombre || asig.objetivoAuditoria.nombreAreaSnapshot;
    if (nombreArea && !actual.areas.includes(nombreArea)) {
      actual.areas.push(nombreArea);
    }

    porAuditor.set(auditorId, actual);
  }

  if (porAuditor.size === 0) {
    return {
      revisados: 0,
      creadas: 0,
      duplicadas: 0,
      sinCorreo: 0,
      fechaRecordatorio: fechaRecordatorioStr,
      esElegible: true,
      esObsoleto: false,
      motivo: 'No se encontraron auditores con auditorías pendientes en este período.',
    };
  }

  let creadas = 0;
  let duplicadas = 0;
  let sinCorreo = 0;

  const urlMisAuditorias = appUrl('/mis-auditorias');

  for (const [auditorId, { auditor, areas }] of porAuditor.entries()) {
    if (areas.length === 0) continue;

    const claveDedupe = `recordatorio-periodo-correo:${auditorId}:${yyyyMM}:P${periodo}`;

    const existente = await tx.notificacion.findUnique({
      where: { claveDedupe },
    });

    if (existente) {
      duplicadas += 1;
      continue;
    }

    const payloadDatos = {
      templateName: 'period_reminder' as const,
      templateVersion: 'v1' as const,
      auditorNombre: auditor.nombre,
      periodo,
      mes: yyyyMM,
      mesEtiqueta,
      fechaLimite: fechaLimiteTexto,
      areas,
      urlMisAuditorias,
    };

    const notificacion = await tx.notificacion.create({
      data: {
        usuarioId: auditor.id,
        claveDedupe,
        tipo: TipoNotificacion.RECORDATORIO,
        titulo: `Recordatorio: Auditorías pendientes Periodo ${periodo} — ${mesEtiqueta}`,
        mensaje: `Hola ${auditor.nombre}, te recordamos que hoy es el último día hábil para completar tus auditorías del Periodo ${periodo} (${mesEtiqueta}): ${areas.join(', ')}.`,
        ruta: '/mis-auditorias',
        datos: payloadDatos,
      },
    });

    const correoNormalizado = normalizarCorreo(auditor.correo);
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
      const dummyHash = hashSha256(`sin-correo:${auditor.id}`);
      await tx.entregaNotificacion.create({
        data: {
          notificacionId: notificacion.id,
          canal: CanalNotificacion.CORREO,
          estado: EstadoEntregaNotificacion.CANCELADA,
          destinoSnapshot: 'sin-correo',
          destinoHash: dummyHash,
          ultimoError: 'El auditor no tiene correo electrónico registrado.',
          programadoEn: ahora,
        },
      });
      sinCorreo += 1;
    }
  }

  return {
    revisados: porAuditor.size,
    creadas,
    duplicadas,
    sinCorreo,
    fechaRecordatorio: fechaRecordatorioStr,
    esElegible: true,
    esObsoleto: false,
    motivo: ventana.motivo,
  };
};
