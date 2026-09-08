import type { Request, Response } from 'express';
import { z } from 'zod';
import { env } from '../../config/env';
import { prisma } from '../../db';
import { RolUsuario } from '../../generated/prisma/enums';
import { appUrl } from '../../utils/app-urls';
import { solicitudInvalida } from '../../utils/errores';
import { mesAnteriorDe, MESES_NOMBRES } from '../../utils/periodos';
import { responder } from '../../utils/respuesta';
import { obtenerVistaMensual } from '../asignaciones/programacion_mensual';
import { generarQrBuffer } from '../notificaciones/qr';
import { renderAuditAssignmentMonthly } from '../notificaciones/templates/audit_assignment_monthly';
import { renderMonthlyResults } from '../notificaciones/templates/monthly_results';
import type { EmailAttachment } from '../notificaciones/proveedores/email';
import { enviarCorreoDirecto } from '../notificaciones/proveedores/email';
import { registrarAuditoria } from '../registros_auditoria/helper';
import { obtenerResultadosGeneral } from '../resultados/servicio';

const esquemaBodyPrueba = z.object({
  tipo: z.enum(['asignaciones', 'resultados']).default('asignaciones'),
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
  let subjectBase = '';
  let htmlBase = '';
  let textBase = '';
  let urlQr = '';

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
    const templateResult = renderMonthlyResults({
      templateName: 'monthly_results',
      templateVersion: 'v1',
      destinatarioNombre: usuarioSimulado.nombre,
      mes: yyyyMM,
      mesEtiqueta,
      areas,
      resultadoGeneral: datosGeneral.resultadoGeneral ?? null,
      urlResultados,
    });

    subjectBase = templateResult.subject;
    htmlBase = templateResult.html;
    textBase = templateResult.text;
    urlQr = urlResultados;
  }

  // 4. Inyectar envoltorio / banner de prueba y prefijo en el asunto
  const subjectPrueba = `[PRUEBA CONTROLADA] ${subjectBase}`;

  const bannerHtml = `
    <div style="background-color: #fef3c7; border: 1px solid #f59e0b; color: #92400e; padding: 14px 18px; border-radius: 8px; margin-bottom: 24px; font-family: sans-serif; font-size: 13px; line-height: 1.5;">
      <strong>⚠️ MODO DE PRUEBA SUPER_ADMIN</strong><br/>
      Este mensaje representa el correo que recibiría <strong>${usuarioSimulado.nombre}</strong> (${usuarioSimulado.correo || 'sin correo'}).<br/>
      Enviado a tu cuenta <strong>${superAdmin.correo}</strong> exclusivamente para validación de diseño y enlaces.
    </div>
  `;

  // Inyectar el banner justo dentro de la tabla principal
  const htmlPrueba = htmlBase.replace(
    '<!-- Body -->\n          <tr>\n            <td style="padding: 32px;">',
    `<!-- Body -->\n          <tr>\n            <td style="padding: 32px;">\n${bannerHtml}`
  );

  const textPrueba = `[MODO DE PRUEBA SUPER_ADMIN]
Destinatario simulado: ${usuarioSimulado.nombre} (${usuarioSimulado.correo || 'sin correo'})
Enviado a: ${superAdmin.correo}
============================================================\n\n${textBase}`;

  // 5. Preparar adjunto QR inline
  const attachments: EmailAttachment[] = [];
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
    },
  });

  responder(res, {
    mensaje: `Correo de prueba enviado exitosamente a tu cuenta (${superAdmin.correo}).`,
    destinatarioPrueba: superAdmin.correo,
    idMensajeExterno: resultadoEnvio.idMensajeExterno || null,
  });
};