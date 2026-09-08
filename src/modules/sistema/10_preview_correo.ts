import type { Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../../db';
import { RolUsuario } from '../../generated/prisma/enums';
import { appUrl } from '../../utils/app-urls';
import { solicitudInvalida } from '../../utils/errores';
import { mesAnteriorDe, MESES_NOMBRES } from '../../utils/periodos';
import { responder } from '../../utils/respuesta';
import { obtenerVistaMensual } from '../asignaciones/programacion_mensual';
import { generarQrBuffer } from '../notificaciones/qr';
import { resolverTemplate } from '../notificaciones/templates';
import { renderAuditAssignmentMonthly } from '../notificaciones/templates/audit_assignment_monthly';
import { renderMonthlyResults } from '../notificaciones/templates/monthly_results';
import { obtenerResultadosGeneral } from '../resultados/servicio';

const esquemaQueryPreview = z.object({
  entregaId: z.coerce.number().int().positive().optional(),
  tipo: z.enum(['asignaciones', 'resultados']).optional(),
  anio: z.coerce.number().int().min(2000).max(2100).optional(),
  mes: z.coerce.number().int().min(1).max(12).optional(),
  usuarioId: z.coerce.number().int().positive().optional(),
});

export const previewCorreoSistema = async (req: Request, res: Response) => {
  const query = esquemaQueryPreview.parse(req.query);

  let destinatario = '';
  let destinatarioNombre = '';
  let subject = '';
  let html = '';
  let text = '';
  let urlBoton = '';
  let urlQr = '';

  if (query.entregaId) {
    const entrega = await prisma.entregaNotificacion.findUniqueOrThrow({
      where: { id: query.entregaId },
      include: {
        notificacion: {
          include: {
            usuario: { select: { id: true, nombre: true, correo: true } },
          },
        },
      },
    });

    destinatario = entrega.destinoSnapshot || entrega.notificacion.usuario.correo || 'sin-correo';
    destinatarioNombre = entrega.notificacion.usuario.nombre;

    const templateResult = resolverTemplate(entrega.notificacion.datos, {
      titulo: entrega.notificacion.titulo,
      mensaje: entrega.notificacion.mensaje,
      ruta: entrega.notificacion.ruta,
    });

    if (!templateResult) {
      throw solicitudInvalida('No se pudo resolver la plantilla para esta entrega.');
    }

    subject = templateResult.subject;
    html = templateResult.html;
    text = templateResult.text;
    urlBoton = templateResult.qrUrl || appUrl(entrega.notificacion.ruta || '/');
    urlQr = templateResult.qrUrl || urlBoton;
  } else if (query.tipo && query.usuarioId) {
    const usuario = await prisma.usuario.findUniqueOrThrow({
      where: { id: query.usuarioId },
      select: { id: true, nombre: true, correo: true, rol: true, activo: true },
    });

    destinatario = usuario.correo || 'sin-correo';
    destinatarioNombre = usuario.nombre;

    const hoy = new Date();
    if (query.tipo === 'asignaciones') {
      const anio = query.anio ?? hoy.getFullYear();
      const mes = query.mes ?? hoy.getMonth() + 1;
      const yyyyMM = `${anio}-${String(mes).padStart(2, '0')}`;
      const mesEtiqueta = `${MESES_NOMBRES[mes - 1]} ${anio}`;

      const vista = await obtenerVistaMensual(prisma, anio, mes);
      const areasAuditor: string[] = [];
      for (const fila of vista.filas) {
        if (fila.auditorMensual?.id === usuario.id && fila.area.nombre) {
          if (!areasAuditor.includes(fila.area.nombre)) {
            areasAuditor.push(fila.area.nombre);
          }
        }
      }

      const urlMisAuditorias = appUrl('/mis-auditorias');
      const templateResult = renderAuditAssignmentMonthly({
        templateName: 'audit_assignment_monthly',
        templateVersion: 'v1',
        auditorNombre: usuario.nombre,
        mes: yyyyMM,
        mesEtiqueta,
        areas: areasAuditor.length > 0 ? areasAuditor : ['(Sin áreas asignadas este mes)'],
        urlMisAuditorias,
      });

      subject = templateResult.subject;
      html = templateResult.html;
      text = templateResult.text;
      urlBoton = urlMisAuditorias;
      urlQr = urlMisAuditorias;
    } else {
      // Resultados
      const mesObjetivo = (query.anio !== undefined && query.mes !== undefined)
        ? { anio: query.anio, mes: query.mes }
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

      // Áreas asignadas a este usuario
      const areasUsuarioRel = await prisma.usuarioArea.findMany({
        where: { usuarioId: usuario.id },
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
        destinatarioNombre: usuario.nombre,
        mes: yyyyMM,
        mesEtiqueta,
        areas,
        resultadoGeneral: datosGeneral.resultadoGeneral ?? null,
        urlResultados,
      });

      subject = templateResult.subject;
      html = templateResult.html;
      text = templateResult.text;
      urlBoton = urlResultados;
      urlQr = urlResultados;
    }
  } else {
    throw solicitudInvalida('Debes especificar entregaId o el conjunto (tipo, anio, mes, usuarioId).');
  }

  // Generar QR en base64 Data URI para renderizado en iframe y preview
  let qrDataUri = '';
  try {
    const qrBuffer = await generarQrBuffer(urlQr);
    qrDataUri = `data:image/png;base64,${qrBuffer.toString('base64')}`;
    // Sustituir cid:qr-code por qrDataUri en el HTML para que el iframe del navegador lo visualice
    html = html.replace('src="cid:qr-code"', `src="${qrDataUri}"`);
  } catch {
    // Si falla QR, continúa sin Data URI
  }

  responder(res, {
    preview: {
      destinatario,
      destinatarioNombre,
      asunto: subject,
      html,
      text,
      urlBoton,
      urlQr,
      qrDataUri,
    },
  });
};