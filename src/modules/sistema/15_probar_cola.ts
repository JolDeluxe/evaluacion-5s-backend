import type { Request, Response } from 'express';
import { env } from '../../config/env';
import { prisma } from '../../db';
import { CanalNotificacion, EstadoEntregaNotificacion, RolUsuario, TipoNotificacion } from '../../generated/prisma/enums';
import { conflicto, prohibido, solicitudInvalida } from '../../utils/errores';
import { responder } from '../../utils/respuesta';
import { registrarAuditoria } from '../registros_auditoria/helper';

/**
 * Genera exactamente una entrega canario en estado PENDIENTE en la cola real.
 * Requisitos de seguridad:
 * - Exclusivamente invocable por SUPER_ADMIN autenticado.
 * - Requiere EMAIL_TEST_ENABLED=true.
 * - Destinatario estrictamente forzado al correo corporativo del SUPER_ADMIN autenticado.
 * - Idempotencia aislada (prefijo canary:), sin interferir con asignaciones, recordatorios ni resultados.
 */
export const probarColaSistema = async (req: Request, res: Response) => {
  // 1. Validar switch de pruebas
  if (!env.EMAIL_TEST_ENABLED) {
    throw solicitudInvalida(
      'La prueba de cola está deshabilitada en la configuración (EMAIL_TEST_ENABLED=false).'
    );
  }

  // 2. Validar autenticación y rol SUPER_ADMIN
  const superAdminId = req.autenticacion?.usuarioId;
  const rol = req.autenticacion?.rol;

  if (!superAdminId || rol !== RolUsuario.SUPER_ADMIN) {
    throw prohibido('Solo un SUPER_ADMIN puede encolar entregas de prueba.');
  }

  // 3. Obtener el usuario SUPER_ADMIN y su correo real
  const superAdmin = await prisma.usuario.findUniqueOrThrow({
    where: { id: superAdminId },
    select: { id: true, nombre: true, correo: true, rol: true },
  });

  if (!superAdmin.correo || superAdmin.correo === 'sin-correo' || !superAdmin.correo.includes('@')) {
    throw conflicto(
      'Tu usuario SUPER_ADMIN no tiene un correo electrónico corporativo válido registrado en su perfil.'
    );
  }

  const ahora = new Date();
  const timestamp = Date.now();
  const claveDedupe = `canary:queue-test:${superAdmin.id}:${timestamp}`;

  const fechaLegible = ahora.toLocaleString('es-MX', {
    timeZone: 'America/Mexico_City',
    dateStyle: 'medium',
    timeStyle: 'medium',
  });

  // 4. Plantilla de correo visual e institucional para la prueba canario
  const htmlContenido = `
    <!DOCTYPE html>
    <html lang="es">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Prueba Canario de Cola 5S</title>
    </head>
    <body style="margin: 0; padding: 24px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; color: #1e293b;">
      <table align="center" border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 580px; margin: 0 auto; background-color: #ffffff; border-radius: 16px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.04);">
        <!-- Encabezado Institucional -->
        <tr>
          <td style="padding: 24px 28px; background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%); color: #ffffff;">
            <div style="font-size: 11px; font-weight: 800; letter-spacing: 0.15em; text-transform: uppercase; color: #94a3b8; margin-bottom: 6px;">
              Manufacturera de Botas Cuadra · Sistema 5S
            </div>
            <h1 style="margin: 0; font-size: 20px; font-weight: 800; color: #ffffff;">
              Prueba Canario de Cola y Worker
            </h1>
          </td>
        </tr>

        <!-- Cuerpo del Correo -->
        <tr>
          <td style="padding: 28px;">
            <div style="display: inline-block; padding: 4px 10px; background-color: #eff6ff; color: #2563eb; border: 1px solid #bfdbfe; border-radius: 9999px; font-size: 10px; font-weight: 800; letter-spacing: 0.05em; text-transform: uppercase; margin-bottom: 16px;">
              ✉ Canal: CORREO · Despachado por Worker Real
            </div>

            <h2 style="margin: 0 0 12px 0; font-size: 17px; font-weight: 700; color: #0f172a;">
              Hola, ${superAdmin.nombre}
            </h2>

            <p style="margin: 0 0 16px 0; font-size: 14px; line-height: 1.6; color: #334155;">
              Este correo confirma que la <strong>cola de despacho y el worker automático en segundo plano</strong> han procesado exitosamente la entrega canario solicitada desde <strong>Sistema → Entregas</strong>.
            </p>

            <!-- Ficha Técnica -->
            <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; margin-bottom: 20px; font-size: 12px;">
              <tr>
                <td style="padding: 10px 14px; border-bottom: 1px solid #edf2f7; font-weight: 700; color: #64748b; width: 38%;">Destinatario:</td>
                <td style="padding: 10px 14px; border-bottom: 1px solid #edf2f7; font-weight: 800; color: #0f172a;">${superAdmin.correo}</td>
              </tr>
              <tr>
                <td style="padding: 10px 14px; border-bottom: 1px solid #edf2f7; font-weight: 700; color: #64748b;">Mecanismo:</td>
                <td style="padding: 10px 14px; border-bottom: 1px solid #edf2f7; color: #0f172a;">Cola de Entregas (Polling con Lock Distribuidor)</td>
              </tr>
              <tr>
                <td style="padding: 10px 14px; border-bottom: 1px solid #edf2f7; font-weight: 700; color: #64748b;">Control Operativo:</td>
                <td style="padding: 10px 14px; border-bottom: 1px solid #edf2f7; font-weight: 700; color: #15803d;">ACTIVO (Validado por el Worker)</td>
              </tr>
              <tr>
                <td style="padding: 10px 14px; font-weight: 700; color: #64748b;">Fecha/Hora CDMX:</td>
                <td style="padding: 10px 14px; color: #0f172a;">${fechaLegible}</td>
              </tr>
            </table>

            <p style="margin: 0; font-size: 12px; line-height: 1.5; color: #64748b;">
              Esta prueba no afectó asignaciones, recordatorios de periodo ni resultados mensuales.
            </p>
          </td>
        </tr>

        <!-- Pie de página -->
        <tr>
          <td style="padding: 16px 28px; background-color: #f1f5f9; border-top: 1px solid #e2e8f0; font-size: 11px; color: #64748b; text-align: center;">
            Manufacturera de Botas Cuadra S.A. de C.V. · Módulo de Control de Entregas
          </td>
        </tr>
      </table>
    </body>
    </html>
  `;

  // 5. Creación atómica de Notificación y Entrega en estado PENDIENTE
  const resultado = await prisma.$transaction(async (tx) => {
    const notificacion = await tx.notificacion.create({
      data: {
        usuarioId: superAdmin.id,
        claveDedupe,
        tipo: TipoNotificacion.SISTEMA,
        titulo: '[Canario 5S] Prueba de Entrega en Cola',
        mensaje: `Prueba canario en cola procesada exitosamente para ${superAdmin.nombre} (${superAdmin.correo}).`,
        ruta: '/sistema/entregas',
        datos: {
          esCanario: true,
          templateName: 'canary_test_queue',
          subject: '[Canario 5S] Prueba de Entrega en Cola',
          destinatarioNombre: superAdmin.nombre,
          destinatarioCorreo: superAdmin.correo,
          fechaGeneracion: fechaLegible,
          html: htmlContenido,
          text: `[Canario 5S] Prueba de Entrega en Cola\n\nHola, ${superAdmin.nombre}.\n\nEsta entrega canario confirma que la cola y el worker están funcionando correctamente.\nDestinatario: ${superAdmin.correo}\nFecha: ${fechaLegible}`,
        },
      },
    });

    const entrega = await tx.entregaNotificacion.create({
      data: {
        notificacionId: notificacion.id,
        canal: CanalNotificacion.CORREO,
        estado: EstadoEntregaNotificacion.PENDIENTE,
        destinoSnapshot: superAdmin.correo,
        programadoEn: ahora,
        intentos: 0,
      },
    });

    return { notificacion, entrega };
  });

  // 6. Registro en auditoría
  await registrarAuditoria({
    usuarioId: superAdmin.id,
    accion: 'PROBAR_COLA_ENTREGAS',
    tipoEntidad: 'EntregaNotificacion',
    idEntidad: resultado.entrega.id,
    datosNuevos: {
      entregaId: resultado.entrega.id,
      notificacionId: resultado.notificacion.id,
      canal: 'CORREO',
      estado: 'PENDIENTE',
      destinatario: superAdmin.correo,
      claveDedupe,
    },
  });

  responder(res, {
    mensaje: `Se encoló exitosamente 1 entrega canario (#${resultado.entrega.id}) en estado PENDIENTE dirigida a ${superAdmin.correo}. Mientras el control operativo esté PAUSADO no saldrá; pulsa 'Reanudar' para que el worker la procese.`,
    entrega: resultado.entrega,
  });
};
