import { randomUUID } from 'node:crypto';
import { env } from '../../config/env';
import { webPush } from '../../config/push';
import { prisma } from '../../db';
import {
  CanalNotificacion,
  EstadoAsignacionAuditoria,
  EstadoEntregaNotificacion,
  RolUsuario,
  TipoNotificacion,
} from '../../generated/prisma/enums';
import {
  evaluarVentanaRecordatorioPeriodo,
  obtenerUltimoDiaHabilPeriodo,
  tieneEnvioResultadoValido,
} from '../../utils/periodos';
import { calcularProximoIntento } from './helper';
import { generarQrBuffer } from './qr';
import { obtenerAdjuntoLogoCuadra } from './logo';
import { resolverTemplate } from './templates';
import { generarPdfResultadosGeneral } from './reportes/pdf-resultados';
import { obtenerResultadosGeneral } from '../resultados/servicio';
import { obtenerEstadoControlOperativo } from './control-operativo';
import type { EmailAttachment } from './proveedores/email';
import { enviarCorreo } from './proveedores/email';
import { enviarWhatsapp } from './proveedores/whatsapp';

const workerId = `worker-${process.pid}-${randomUUID()}`;
const MAX_INTENTOS = 5;

export const procesarEntregasPendientes = async () => {
  const ahora = new Date();

  // Filtrar canales activos según configuración y control operativo.
  // Si EMAIL_ENABLED=false o el control operativo está en PAUSADO (fail-safe),
  // las entregas por canal CORREO permanecen en PENDIENTE sin ser reclamadas ni fallar.
  const infoControl = await obtenerEstadoControlOperativo();
  const canalesPermitidos: CanalNotificacion[] = [CanalNotificacion.PUSH, CanalNotificacion.WHATSAPP];
  if (infoControl.estado === 'ACTIVO' && (env.EMAIL_ENABLED || env.EMAIL_TEST_ENABLED)) {
    canalesPermitidos.push(CanalNotificacion.CORREO);
  }

  const candidatos = await prisma.entregaNotificacion.findMany({
    where: {
      canal: { in: canalesPermitidos },
      OR: [
        { estado: EstadoEntregaNotificacion.PENDIENTE, programadoEn: { lte: ahora }, intentos: { lt: MAX_INTENTOS } },
        { estado: EstadoEntregaNotificacion.FALLIDA, proximoIntentoEn: { lte: ahora, not: null }, intentos: { lt: MAX_INTENTOS } },
        { estado: EstadoEntregaNotificacion.PROCESANDO, bloqueadoHasta: { lt: ahora } },
      ],
    },
    take: 25,
    orderBy: { programadoEn: 'asc' },
  });

  for (const candidato of candidatos) {
    const reclamado = await prisma.entregaNotificacion.updateMany({
      where: {
        id: candidato.id,
        canal: { in: canalesPermitidos },
        OR: [
          { estado: EstadoEntregaNotificacion.PENDIENTE, intentos: { lt: MAX_INTENTOS } },
          { estado: EstadoEntregaNotificacion.FALLIDA, proximoIntentoEn: { lte: ahora, not: null }, intentos: { lt: MAX_INTENTOS } },
          { estado: EstadoEntregaNotificacion.PROCESANDO, bloqueadoHasta: { lt: ahora } },
        ],
      },
      data: {
        estado: EstadoEntregaNotificacion.PROCESANDO,
        bloqueadoHasta: new Date(Date.now() + 2 * 60 * 1000),
        bloqueadoPor: workerId,
      },
    });
    if (reclamado.count !== 1) continue;

    await procesarEntrega(candidato.id);
  }
};

const procesarEntrega = async (id: number) => {
  const entrega = await prisma.entregaNotificacion.findUniqueOrThrow({
    where: { id },
    include: { notificacion: true, suscripcionPush: true },
  });

  try {
    if (entrega.canal === CanalNotificacion.PUSH) {
      if (!env.VAPID_ENABLED || !entrega.suscripcionPush) throw new Error('Push no configurado');
      await webPush.sendNotification(
        {
          endpoint: entrega.suscripcionPush.endpoint,
          keys: { p256dh: entrega.suscripcionPush.p256dh, auth: entrega.suscripcionPush.auth },
        },
        JSON.stringify({
          titulo: entrega.notificacion.titulo,
          mensaje: entrega.notificacion.mensaje,
          ruta: entrega.notificacion.ruta,
        })
      );
    } else if (entrega.canal === CanalNotificacion.CORREO) {
      // Revalidación inmediata de control operativo: si el sistema fue pausado
      // o el envío de correo no está habilitado mientras la entrega estaba reclamada, liberarla a PENDIENTE.
      const infoControl = await obtenerEstadoControlOperativo();
      const datosPayload = (entrega.notificacion.datos || {}) as Record<string, unknown>;
      const esCanario = Boolean(datosPayload.esCanario || entrega.notificacion.claveDedupe?.startsWith('canary:'));
      const correoHabilitado = env.EMAIL_ENABLED || (env.EMAIL_TEST_ENABLED && esCanario);

      if (!correoHabilitado || infoControl.estado !== 'ACTIVO') {
        await prisma.entregaNotificacion.update({
          where: { id },
          data: {
            estado: EstadoEntregaNotificacion.PENDIENTE,
            bloqueadoHasta: null,
            bloqueadoPor: null,
          },
        });
        return;
      }

      if (!entrega.destinoSnapshot || entrega.destinoSnapshot === 'sin-correo') {
        const err = new Error('Destino de correo no informado');
        (err as unknown as { permanente: boolean }).permanente = true;
        throw err;
      }

      // Revalidación previa al envío para RECORDATORIO de periodo:
      // 1. Si la fecha límite del recordatorio ya expiró (ej. pausa prolongada), cancelar ordenadamente.
      // 2. Si el auditor ya terminó sus auditorías pendientes, cancelar ordenadamente sin enviar.
      if (
        entrega.notificacion.tipo === TipoNotificacion.RECORDATORIO &&
        datosPayload.templateName === 'period_reminder'
      ) {
        const periodo = Number(datosPayload.periodo);
        const mesStr = String(datosPayload.mes || '');
        const [anioStr, numMesStr] = mesStr.split('-');
        const anio = Number(anioStr);
        const mes = Number(numMesStr);

        if (anio && mes && (periodo === 1 || periodo === 2)) {
          // Revalidar si la ventana ya es obsoleta
          const diasInhabiles = await prisma.diaInhabil.findMany({ select: { fecha: true } });
          const diasInhabilesSet = new Set(diasInhabiles.map((d) => {
            const f = new Date(d.fecha);
            return `${f.getUTCFullYear()}-${String(f.getUTCMonth() + 1).padStart(2, '0')}-${String(f.getUTCDate()).padStart(2, '0')}`;
          }));
          const fechaRecordatorio = obtenerUltimoDiaHabilPeriodo(anio, mes, periodo as 1 | 2, diasInhabilesSet);
          const ventana = evaluarVentanaRecordatorioPeriodo(fechaRecordatorio, new Date());
          if (ventana.esObsoleto) {
            await prisma.entregaNotificacion.update({
              where: { id },
              data: {
                estado: EstadoEntregaNotificacion.CANCELADA,
                proximoIntentoEn: null,
                ultimoError: `Recordatorio vencido (${ventana.motivo}). Envío cancelado por fecha expirada.`,
                bloqueadoHasta: null,
                bloqueadoPor: null,
              },
            });
            return;
          }

          const asignaciones = await prisma.asignacionAuditoria.findMany({
            where: {
              auditorId: entrega.notificacion.usuarioId,
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
              objetivoAuditoria: {
                include: { envioResultado: true, enviosAuditoria: true },
              },
            },
          });

          const pendientesReales = asignaciones.filter(
            (asig) => !tieneEnvioResultadoValido(asig.objetivoAuditoria)
          );

          if (pendientesReales.length === 0) {
            // El auditor ya concluyó sus auditorías; no enviar aviso extemporáneo ni marcar FALLIDA
            await prisma.entregaNotificacion.update({
              where: { id },
              data: {
                estado: EstadoEntregaNotificacion.CANCELADA,
                proximoIntentoEn: null,
                ultimoError: 'Auditorías ya completadas previamente. Envío de recordatorio omitido.',
                bloqueadoHasta: null,
                bloqueadoPor: null,
              },
            });
            return;
          }
        }
      }

      const templateResult = resolverTemplate(entrega.notificacion.datos, {
        titulo: entrega.notificacion.titulo,
        mensaje: entrega.notificacion.mensaje,
        ruta: entrega.notificacion.ruta,
      });

      const attachments: EmailAttachment[] = [];
      const logoAttachment = obtenerAdjuntoLogoCuadra();
      if (logoAttachment) {
        attachments.push(logoAttachment);
      }

      if (templateResult?.qrUrl) {
        try {
          const qrBuffer = await generarQrBuffer(templateResult.qrUrl);
          attachments.push({
            filename: 'qr-code.png',
            content: qrBuffer,
            cid: 'qr-code',
            contentType: 'image/png',
            contentDisposition: 'inline',
          });
        } catch {
          // Si falla la generación del QR, continuar con el correo sin bloquear
        }
      }

      // Adjuntar PDF de Resultados Generales para correos de resultados mensuales
      if (
        entrega.notificacion.tipo === TipoNotificacion.RESULTADO_MENSUAL_CORREO ||
        datosPayload.templateName === 'monthly_results'
      ) {
        try {
          const mesYMD = String(datosPayload.mes || '');
          const mesEtiqueta = String(datosPayload.mesEtiqueta || mesYMD);
          if (mesYMD) {
            const authInterna = { usuarioId: 0, rol: RolUsuario.SUPER_ADMIN };
            const datosGeneral = await obtenerResultadosGeneral(prisma, authInterna, {
              tipo: 'mes',
              mes: mesYMD,
            });
            const pdfBuffer = await generarPdfResultadosGeneral(datosGeneral, mesEtiqueta);
            attachments.push({
              filename: `Resultados Generales 5S - ${mesYMD}.pdf`,
              content: pdfBuffer,
              contentType: 'application/pdf',
            });
          }
        } catch {
          // Si falla la generación del PDF, continuar con el despacho del correo
        }
      }

      const resEnvio = await enviarCorreo(
        {
          to: entrega.destinoSnapshot,
          subject: (datosPayload.subject as string) ?? templateResult?.subject ?? entrega.notificacion.titulo,
          text: (datosPayload.text as string) ?? templateResult?.text ?? entrega.notificacion.mensaje,
          html: (datosPayload.html as string) ?? templateResult?.html,
          attachments: attachments.length > 0 ? attachments : undefined,
        },
        { esCanario }
      );

      if (!resEnvio.enviado) {
        const error = new Error(resEnvio.error ?? 'Fallo al enviar correo');
        (error as unknown as { permanente?: boolean; retryAfterSeconds?: number }).permanente = resEnvio.permanente;
        (error as unknown as { permanente?: boolean; retryAfterSeconds?: number }).retryAfterSeconds = resEnvio.retryAfterSeconds;
        throw error;
      }
    } else if (entrega.canal === CanalNotificacion.WHATSAPP) {
      if (!entrega.destinoSnapshot) throw new Error('Destino WhatsApp no informado');
      const resultado = await enviarWhatsapp(entrega.destinoSnapshot, entrega.notificacion.mensaje);
      if (!resultado.enviado) throw new Error(resultado.error);
    }

    await prisma.entregaNotificacion.update({
      where: { id },
      data: {
        estado: EstadoEntregaNotificacion.ENVIADA,
        enviadoEn: new Date(),
        ultimoIntentoEn: new Date(),
        bloqueadoHasta: null,
        bloqueadoPor: null,
        ultimoError: null,
      },
    });
  } catch (error) {
    const errObj = error as { permanente?: boolean; message?: string; retryAfterSeconds?: number };
    const esPermanente = errObj?.permanente === true;
    const nuevosIntentos = Math.min(MAX_INTENTOS, entrega.intentos + 1);
    const maxAlcanzado = nuevosIntentos >= MAX_INTENTOS;

    let proximoIntentoEn: Date | null = null;
    if (!esPermanente && !maxAlcanzado) {
      if (typeof errObj?.retryAfterSeconds === 'number' && errObj.retryAfterSeconds > 0) {
        proximoIntentoEn = new Date(Date.now() + errObj.retryAfterSeconds * 1000);
      } else {
        proximoIntentoEn = calcularProximoIntento(nuevosIntentos);
      }
    }

    await prisma.entregaNotificacion.update({
      where: { id },
      data: {
        estado: EstadoEntregaNotificacion.FALLIDA,
        intentos: nuevosIntentos,
        ultimoIntentoEn: new Date(),
        proximoIntentoEn,
        ultimoError: error instanceof Error ? error.message.slice(0, 1000) : 'Error desconocido',
        bloqueadoHasta: null,
        bloqueadoPor: null,
      },
    });
  }
};