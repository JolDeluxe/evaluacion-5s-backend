import type { Request, Response } from 'express';
import { z } from 'zod';
import { env } from '../../config/env';
import { prisma } from '../../db';
import { EstadoAsignacionAuditoria, RolUsuario } from '../../generated/prisma/enums';
import { appUrl } from '../../utils/app-urls';
import { solicitudInvalida } from '../../utils/errores';
import {
  mesAnteriorDe,
  MESES_NOMBRES,
  obtenerUltimoDiaHabilPeriodo,
  tieneEnvioResultadoValido,
} from '../../utils/periodos';
import { responder } from '../../utils/respuesta';
import { obtenerVistaMensual } from '../asignaciones/programacion_mensual';
import { generarQrBuffer } from '../notificaciones/qr';
import { obtenerAdjuntoLogoCuadra } from '../notificaciones/logo';
import { renderAuditAssignmentMonthly } from '../notificaciones/templates/audit_assignment_monthly';
import { renderPeriodReminder } from '../notificaciones/templates/period_reminder';
import { renderMonthlyResults } from '../notificaciones/templates/monthly_results';
import { generarPdfResultadosGeneral } from '../notificaciones/reportes/pdf-resultados';
import type { EmailAttachment } from '../notificaciones/proveedores/email';
import { enviarCorreoDirecto } from '../notificaciones/proveedores/email';
import { registrarAuditoria } from '../registros_auditoria/helper';
import { obtenerResultadosGeneral } from '../resultados/servicio';
import { crearTokenDescargaPdf } from '../resultados/token_descarga_pdf';

const esquemaBodyPrueba = z.object({
  tipo: z.enum(['asignaciones', 'recordatorio_p1', 'recordatorio_p2', 'resultados']).default('asignaciones'),
  anio: z.coerce.number().int().min(2000).max(2100).optional(),
  mes: z.coerce.number().int().min(1).max(12).optional(),
  usuarioId: z.coerce.number().int().positive().optional(),
});

export const enviarPruebaCorreoSistema = async (req: Request, res: Response) => {
  // 1. Validar kill switch exclusivo de prueba
  if (!env.EMAIL_TEST_ENABLED) {
    throw solicitudInvalida(
      'El envío manual de correos de prueba está deshabilitado en la configuración (EMAIL_TEST_ENABLED=false).'
    );
  }

  // 2. Obtener el SUPER_ADMIN autenticado
  const superAdminId = req.autenticacion?.usuarioId;
  if (!superAdminId) {
    throw solicitudInvalida('Usuario no autenticado.');
  }

  const superAdmin = await prisma.usuario.findUniqueOrThrow({
    where: { id: superAdminId },
    select: { id: true, nombre: true, correo: true, rol: true },
  });

  if (!superAdmin.correo) {
    throw solicitudInvalida(
      'Tu usuario SUPER_ADMIN no tiene un correo electrónico configurado en su perfil para recibir mensajes de prueba.'
    );
  }

  // 3. Resolver destinatario simulado y plantilla
  const body = esquemaBodyPrueba.parse(req.body);
  const targetUsuarioId = body.usuarioId ?? superAdmin.id;

  const usuarioSimulado = await prisma.usuario.findUniqueOrThrow({
    where: { id: targetUsuarioId },
    select: { id: true, nombre: true, correo: true, rol: true },
  });

  const hoy = new Date();
  let subjectBase: string;
  let htmlBase: string;
  let textBase: string;
  let urlQr: string;
  const attachmentsExtra: EmailAttachment[] = [];

  if (body.tipo === 'asignaciones') {
    const anio = body.anio ?? hoy.getFullYear();
    const mes = body.mes ?? hoy.getMonth() + 1;
    const yyyyMM = `${anio}-${String(mes).padStart(2, '0')}`;
    const mesEtiqueta = `${MESES_NOMBRES[mes - 1]} ${anio}`;

    const vista = await obtenerVistaMensual(prisma, anio, mes);
    const areasAuditor: string[] = [];
    for (const fila of vista.filas) {
      if (fila.auditorMensual?.id === usuarioSimulado.id && fila.area.nombre) {
        if (!areasAuditor.includes(fila.area.nombre)) {
          areasAuditor.push(fila.area.nombre);
        }
      }
    }

    const urlMisAuditorias = appUrl('/mis-auditorias');
    const templateResult = renderAuditAssignmentMonthly({
      templateName: 'audit_assignment_monthly',
      templateVersion: 'v1',
      auditorNombre: usuarioSimulado.nombre,
      mes: yyyyMM,
      mesEtiqueta,
      areas: areasAuditor.length > 0 ? areasAuditor : ['(Sin áreas asignadas este mes)'],
      urlMisAuditorias,
    });

    subjectBase = templateResult.subject;
    htmlBase = templateResult.html;
    textBase = templateResult.text;
    urlQr = urlMisAuditorias;
  } else if (body.tipo === 'recordatorio_p1' || body.tipo === 'recordatorio_p2') {
    const periodo: 1 | 2 = body.tipo === 'recordatorio_p1' ? 1 : 2;
    const anio = body.anio ?? hoy.getFullYear();
    const mes = body.mes ?? hoy.getMonth() + 1;
    const yyyyMM = `${anio}-${String(mes).padStart(2, '0')}`;
    const mesEtiqueta = `${MESES_NOMBRES[mes - 1]} ${anio}`;

    const fechaRecordatorio = obtenerUltimoDiaHabilPeriodo(anio, mes, periodo);
    const fechaLimiteTexto = `${fechaRecordatorio.getDate()} de ${MESES_NOMBRES[mes - 1]} de ${anio}`;

    const asignaciones = await prisma.asignacionAuditoria.findMany({
      where: {
        auditorId: usuarioSimulado.id,
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
          include: {
            envioResultado: true,
            enviosAuditoria: true,
            area: { select: { id: true, nombre: true } },
          },
        },
      },
    });

    const areasPendientes: string[] = [];
    for (const asig of asignaciones) {
      if (tieneEnvioResultadoValido(asig.objetivoAuditoria)) continue;
      const nombre = asig.objetivoAuditoria.area?.nombre || asig.objetivoAuditoria.nombreAreaSnapshot;
      if (nombre && !areasPendientes.includes(nombre)) {
        areasPendientes.push(nombre);
      }
    }

    const urlMisAuditorias = appUrl('/mis-auditorias');
    const templateResult = renderPeriodReminder({
      templateName: 'period_reminder',
      templateVersion: 'v1',
      auditorNombre: usuarioSimulado.nombre,
      periodo,
      mes: yyyyMM,
      mesEtiqueta,
      fechaLimite: fechaLimiteTexto,
      areas: areasPendientes.length > 0 ? areasPendientes : ['(Todas las auditorías están completadas o sin pendientes)'],
      urlMisAuditorias,
    });

    subjectBase = templateResult.subject;
    htmlBase = templateResult.html;
    textBase = templateResult.text;
    urlQr = urlMisAuditorias;
  } else {
    // Resultados
    const mesObjetivo = (body.anio !== undefined && body.mes !== undefined)
      ? { anio: body.anio, mes: body.mes }
      : mesAnteriorDe(hoy.getFullYear(), hoy.getMonth() + 1);

    const { anio, mes } = mesObjetivo;
    const yyyyMM = `${anio}-${String(mes).padStart(2, '0')}`;
    const mesEtiqueta = `${MESES_NOMBRES[mes - 1]} ${anio}`;

    const authInterna = { usuarioId: 0, rol: RolUsuario.SUPER_ADMIN };
    const datosGeneral = await obtenerResultadosGeneral(prisma, authInterna, {
      tipo: 'mes',
      mes: yyyyMM,
    });

    const areasConResultado = (datosGeneral.areas ?? []) as Array<{
      area: { id: number; nombre: string };
      resultadoMensual?: number | null;
    }>;

    const areasUsuarioRel = await prisma.usuarioArea.findMany({
      where: { usuarioId: usuarioSimulado.id },
      select: { areaId: true },
    });
    const areaIdsUsuario = new Set(areasUsuarioRel.map((r) => r.areaId));

    const areas = areasConResultado
      .filter((a) => areaIdsUsuario.has(a.area.id))
      .map((a) => ({
        nombre: a.area.nombre,
        resultado: a.resultadoMensual ?? null,
      }));

    const urlResultados = appUrl(`/resultados/general?tipo=mes&mes=${yyyyMM}`);
    const tokenPdf = crearTokenDescargaPdf({ tipo: 'mes', mes: yyyyMM, usuarioId: usuarioSimulado.id });
    const urlDescargaPdf = appUrl(`/api/v1/resultados/reportes/general/pdf-directo?token=${tokenPdf}`);
    const templateResult = renderMonthlyResults({
      templateName: 'monthly_results',
      templateVersion: 'v1',
      destinatarioNombre: usuarioSimulado.nombre,
      mes: yyyyMM,
      mesEtiqueta,
      areas,
      resultadoGeneral: datosGeneral.resultadoGeneral ?? null,
      urlResultados,
      urlDescargaPdf,
    });

    subjectBase = templateResult.subject;
    htmlBase = templateResult.html;
    textBase = templateResult.text;
    urlQr = urlResultados;

    // Generar y adjuntar el PDF de Resultados Generales real
    try {
      const pdfBuffer = await generarPdfResultadosGeneral(datosGeneral, mesEtiqueta);
      attachmentsExtra.push({
        filename: `Resultados Generales 5S - ${yyyyMM}.pdf`,
        content: pdfBuffer,
        contentType: 'application/pdf',
      });
    } catch (err) {
      console.error('[EnviarPrueba] Error al generar PDF de resultados:', err);
    }
  }

  // 4. Inyectar envoltorio / banner de prueba y prefijo en el asunto
  const subjectPrueba = `[PRUEBA CONTROLADA] ${subjectBase}`;

  const bannerHtml = `
    <div style="background-color: #fef3c7; border: 1px solid #f59e0b; color: #92400e; padding: 14px 18px; border-radius: 8px; margin-bottom: 24px; font-family: sans-serif; font-size: 13px; line-height: 1.5;">
      <strong>⚠️ MODO DE PRUEBA SUPER_ADMIN</strong><br/>
      Este mensaje representa el correo que recibiría <strong>${usuarioSimulado.nombre}</strong> (${usuarioSimulado.correo || 'sin correo'}).<br/>
      Enviado a tu cuenta <strong>${superAdmin.correo}</strong> exclusivamente para validación de diseño, QR, enlaces y archivos adjuntos.
    </div>
  `;

  // Inyectar el banner justo dentro de la tabla principal sobre el título
  const htmlPrueba = htmlBase.includes('<h1 style="margin: 0 0 20px 0;')
    ? htmlBase.replace(
        '<h1 style="margin: 0 0 20px 0;',
        `${bannerHtml}\n              <h1 style="margin: 0 0 20px 0;`
      )
    : htmlBase.replace('<!-- Body -->', `<!-- Body -->\n${bannerHtml}`);

  const textPrueba = `[MODO DE PRUEBA SUPER_ADMIN]
Destinatario simulado: ${usuarioSimulado.nombre} (${usuarioSimulado.correo || 'sin correo'})
Enviado a: ${superAdmin.correo}
============================================================\n\n${textBase}`;

  // 5. Preparar adjuntos inline CID (Logo de Cuadra y Código QR) + Adjuntos de reporte
  const attachments: EmailAttachment[] = [];

  const logoAttachment = obtenerAdjuntoLogoCuadra();
  if (logoAttachment) {
    attachments.push(logoAttachment);
  }

  try {
    const qrBuffer = await generarQrBuffer(urlQr);
    attachments.push({
      filename: 'qr-code.png',
      content: qrBuffer,
      cid: 'qr-code',
      contentType: 'image/png',
      contentDisposition: 'inline',
    });
  } catch {
    // Continuar si falla QR
  }

  for (const att of attachmentsExtra) {
    attachments.push(att);
  }

  // 6. Enviar ÚNICA Y EXCLUSIVAMENTE a superAdmin.correo
  const resultadoEnvio = await enviarCorreoDirecto({
    to: superAdmin.correo,
    subject: subjectPrueba,
    html: htmlPrueba,
    text: textPrueba,
    attachments: attachments.length > 0 ? attachments : undefined,
  });

  if (!resultadoEnvio.enviado) {
    throw solicitudInvalida(resultadoEnvio.error || 'Error al enviar correo de prueba.');
  }

  // 7. Registrar en auditoría técnica
  await registrarAuditoria({
    usuarioId: superAdmin.id,
    accion: 'PRUEBA_CORREO_ENVIADA',
    tipoEntidad: 'Usuario',
    idEntidad: usuarioSimulado.id,
    datosNuevos: {
      enviadoA: superAdmin.correo,
      usuarioSimuladoId: usuarioSimulado.id,
      tipo: body.tipo,
      asunto: subjectPrueba,
      proveedor: env.EMAIL_PROVIDER,
      idMensajeExterno: resultadoEnvio.idMensajeExterno || null,
      adjuntosCount: attachments.length,
    },
  });

  responder(res, {
    mensaje: `Correo de prueba enviado exitosamente a tu cuenta (${superAdmin.correo}).`,
    destinatarioPrueba: superAdmin.correo,
    idMensajeExterno: resultadoEnvio.idMensajeExterno || null,
    adjuntosCount: attachments.length,
  });
};