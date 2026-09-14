import { describe, expect, it } from 'bun:test';
import { simpleParser } from 'mailparser';
import { prisma } from '../db';
import { CanalNotificacion, EstadoEntregaNotificacion, RolUsuario, TipoNotificacion } from '../generated/prisma/enums';
import {
  esPosibleNdr,
  extraerDiagnosticoNdr,
  extraerMessageIdOriginal,
  normalizarCandidatosMessageId,
  procesarRebotesEntrantes,
} from '../modules/notificaciones/servicio_rebotes';

describe('NDR Bounce Listener (Servicio de Rebotes IMAP / Exchange)', () => {
  describe('Detección de posibles NDRs (esPosibleNdr)', () => {
    it('detecta remitentes típicos de rebote (postmaster, mailer-daemon, etc.)', () => {
      expect(esPosibleNdr('postmaster@cuadra.com.mx', 'Algo')).toBe(true);
      expect(esPosibleNdr('MAILER-DAEMON@outlook.com', 'Fallo')).toBe(true);
      expect(esPosibleNdr('Microsoft Outlook <outlook@microsoft.com>', 'Reporte')).toBe(true);
      expect(esPosibleNdr('System Administrator', 'Notificación')).toBe(true);
    });

    it('detecta asuntos típicos de rebote (Undeliverable, No se pudo entregar, etc.)', () => {
      expect(esPosibleNdr('usuario@empresa.com', 'Undeliverable: Asignación Mensual')).toBe(true);
      expect(esPosibleNdr('soporte@empresa.com', 'No se pudo entregar: Auditorías 5S')).toBe(true);
      expect(esPosibleNdr('noreply@server.com', 'Delivery Status Notification (Failure)')).toBe(true);
      expect(esPosibleNdr('mailer@server.com', 'Mail delivery failed: returning message to sender')).toBe(true);
      expect(esPosibleNdr('mail@server.com', 'failure notice')).toBe(true);
    });

    it('ignora correos legítimos o de usuarios estándar', () => {
      expect(esPosibleNdr('andrea.hernandez@cuadra.com.mx', 'Resumen de auditoría Área Montado')).toBe(false);
      expect(esPosibleNdr('admin@empresa.com', 'Recordatorio de reunión')).toBe(false);
      expect(esPosibleNdr(undefined, undefined)).toBe(false);
    });
  });

  describe('Normalización de Message-ID (normalizarCandidatosMessageId)', () => {
    it('genera candidatos con y sin corchetes angulares', () => {
      const candidatosConCorchetes = normalizarCandidatosMessageId('<87a4e3f3@cuadra.com.mx>');
      expect(candidatosConCorchetes).toContain('87a4e3f3@cuadra.com.mx');
      expect(candidatosConCorchetes).toContain('<87a4e3f3@cuadra.com.mx>');

      const candidatosSinCorchetes = normalizarCandidatosMessageId('87a4e3f3@cuadra.com.mx');
      expect(candidatosSinCorchetes).toContain('87a4e3f3@cuadra.com.mx');
      expect(candidatosSinCorchetes).toContain('<87a4e3f3@cuadra.com.mx>');
    });

    it('devuelve array vacío si el ID está en blanco o solo contiene corchetes/espacios', () => {
      expect(normalizarCandidatosMessageId('')).toEqual([]);
      expect(normalizarCandidatosMessageId('   ')).toEqual([]);
      expect(normalizarCandidatosMessageId('<>')).toEqual([]);
    });
  });

  describe('Extracción de Message-ID original (extraerMessageIdOriginal)', () => {
    it('extrae el Message-ID desde la cabecera In-Reply-To', async () => {
      const raw = [
        'From: postmaster@cuadra.com.mx',
        'Subject: Undeliverable: Asignación',
        'In-Reply-To: <orig-msg-1234@cuadra.com.mx>',
        '',
        'El mensaje no pudo entregarse.',
      ].join('\r\n');

      const parsed = await simpleParser(raw);
      const msgId = extraerMessageIdOriginal(parsed);
      expect(msgId).toBe('<orig-msg-1234@cuadra.com.mx>');
    });

    it('extrae el Message-ID desde la cabecera References si In-Reply-To no está presente', async () => {
      const raw = [
        'From: postmaster@cuadra.com.mx',
        'Subject: Undeliverable: Asignación',
        'References: <orig-ref-5678@cuadra.com.mx>',
        '',
        'El mensaje no pudo entregarse.',
      ].join('\r\n');

      const parsed = await simpleParser(raw);
      const msgId = extraerMessageIdOriginal(parsed);
      expect(msgId).toBe('<orig-ref-5678@cuadra.com.mx>');
    });

    it('extrae el Message-ID del cuerpo del correo (formato típico de Exchange con encabezados originales)', async () => {
      const raw = [
        'From: postmaster@cuadra.com.mx',
        'Subject: No se pudo entregar: Asignación Mensual',
        '',
        'No se pudo entregar a correo_inventado@cuadra.com.mx',
        'Información de diagnóstico para los administradores:',
        'Remote server returned 550 5.1.10 RecipientNotFound',
        '',
        'Encabezados de mensaje originales:',
        'Received: from mail.cuadra.com.mx',
        'Message-ID: <c78d05ee-85eb-4a25-9ef8-028bb46c703b@cuadra.com.mx>',
        'Subject: Asignación Mensual',
      ].join('\r\n');

      const parsed = await simpleParser(raw);
      const msgId = extraerMessageIdOriginal(parsed);
      expect(msgId).toBe('<c78d05ee-85eb-4a25-9ef8-028bb46c703b@cuadra.com.mx>');
    });

    it('extrae el Message-ID desde un adjunto RFC 3464 (message/delivery-status o text)', async () => {
      const boundary = 'boundary_test_ndr_123';
      const raw = [
        'From: postmaster@cuadra.com.mx',
        'Subject: Undeliverable',
        'MIME-Version: 1.0',
        `Content-Type: multipart/report; report-type=delivery-status; boundary="${boundary}"`,
        '',
        `--${boundary}`,
        'Content-Type: text/plain; charset=utf-8',
        '',
        'Fallo general de entrega.',
        `--${boundary}`,
        'Content-Type: message/delivery-status',
        '',
        'Reporting-MTA: dns; mail.server',
        'Original-Message-ID: <adjunto-uuid-999@cuadra.com.mx>',
        `--${boundary}--`,
      ].join('\r\n');

      const parsed = await simpleParser(raw);
      const msgId = extraerMessageIdOriginal(parsed);
      expect(msgId).toBe('<adjunto-uuid-999@cuadra.com.mx>');
    });

    it('retorna null si no se encuentra ningún Message-ID', async () => {
      const raw = [
        'From: postmaster@cuadra.com.mx',
        'Subject: Undeliverable',
        '',
        'Error genérico sin encabezados originales.',
      ].join('\r\n');

      const parsed = await simpleParser(raw);
      const msgId = extraerMessageIdOriginal(parsed);
      expect(msgId).toBeNull();
    });
  });

  describe('Extracción de diagnóstico NDR (extraerDiagnosticoNdr)', () => {
    it('extrae el error exacto de Exchange cuando contiene "Remote server returned ..."', async () => {
      const raw = [
        'From: postmaster@cuadra.com.mx',
        'Subject: No se pudo entregar',
        '',
        "Remote server returned '550 5.1.10 RESOLVER.ADR.RecipientNotFound; Recipient not found by SMTP address lookup'",
      ].join('\r\n');

      const parsed = await simpleParser(raw);
      const diag = extraerDiagnosticoNdr(parsed);
      expect(diag).toBe('550 5.1.10 RESOLVER.ADR.RecipientNotFound; Recipient not found by SMTP address lookup');
    });

    it('extrae Diagnostic-Code RFC 3464', async () => {
      const raw = [
        'From: mailer-daemon@server.com',
        'Subject: Failure notice',
        '',
        'Diagnostic-Code: smtp; 550 5.1.1 <invalido@cuadra.com.mx>: Recipient address rejected: User unknown',
      ].join('\r\n');

      const parsed = await simpleParser(raw);
      const diag = extraerDiagnosticoNdr(parsed);
      expect(diag).toContain('550 5.1.1');
      expect(diag).toContain('User unknown');
    });

    it('extrae códigos de estado SMTP 5xx estándar', async () => {
      const raw = [
        'From: postmaster@cuadra.com.mx',
        'Subject: Delivery failure',
        '',
        'El servidor remoto respondió: 550 5.2.1 Mailbox is disabled or inactive',
      ].join('\r\n');

      const parsed = await simpleParser(raw);
      const diag = extraerDiagnosticoNdr(parsed);
      expect(diag).toContain('550 5.2.1');
    });

    it('utiliza fallback explicativo si no hay código SMTP identificable', async () => {
      const raw = [
        'From: postmaster@cuadra.com.mx',
        'Subject: Undeliverable',
        '',
        'Mensaje no entregado por razones desconocidas sin códigos estándar.',
      ].join('\r\n');

      const parsed = await simpleParser(raw);
      const diag = extraerDiagnosticoNdr(parsed);
      expect(diag).toBe('Rebote recibido del servidor de destino (NDR - Dirección no válida o no encontrada)');
    });
  });

  describe('Actualización atómica en Base de Datos de ENVIADA a FALLIDA', () => {
    it('actualiza entrega ENVIADA a FALLIDA, anula proximoIntentoEn y registra el error NDR', async () => {
      const timestamp = Date.now();
      const usuario = await prisma.usuario.create({
        data: {
          nombreUsuario: `user_ndr_${timestamp}`,
          nombre: `Test NDR ${timestamp}`,
          correo: `correo_inventado_${timestamp}@cuadra.com.mx`,
          hashContrasena: 'hash-dummy',
          rol: RolUsuario.AUDITOR,
          activo: true,
        },
      });

      const notif = await prisma.notificacion.create({
        data: {
          usuarioId: usuario.id,
          claveDedupe: `test-ndr:${usuario.id}:${timestamp}`,
          tipo: TipoNotificacion.ASIGNACION_MENSUAL_CORREO,
          titulo: 'Asignación Mensual — Test NDR',
          mensaje: 'Mensaje de asignación',
          datos: { templateName: 'audit_assignment_monthly' },
        },
      });

      const rawMsgId = `<msg-ndr-test-${timestamp}@cuadra.com.mx>`;

      const entrega = await prisma.entregaNotificacion.create({
        data: {
          notificacionId: notif.id,
          canal: CanalNotificacion.CORREO,
          estado: EstadoEntregaNotificacion.ENVIADA,
          destinoSnapshot: usuario.correo!,
          idMensajeExterno: rawMsgId,
          enviadoEn: new Date(),
          programadoEn: new Date(),
          intentos: 1,
        },
      });

      try {
        // Simular llegada de rebote para ese Message-ID
        const candidatos = normalizarCandidatosMessageId(rawMsgId);
        const diagnostico = '550 5.1.10 RESOLVER.ADR.RecipientNotFound; Recipient not found';

        const updateResult = await prisma.entregaNotificacion.updateMany({
          where: {
            idMensajeExterno: { in: candidatos },
            estado: EstadoEntregaNotificacion.ENVIADA,
          },
          data: {
            estado: EstadoEntregaNotificacion.FALLIDA,
            proximoIntentoEn: null,
            ultimoError: `[NDR Asíncrono] ${diagnostico}`,
          },
        });

        expect(updateResult.count).toBe(1);

        const entregaActualizada = await prisma.entregaNotificacion.findUniqueOrThrow({
          where: { id: entrega.id },
        });

        expect(entregaActualizada.estado).toBe(EstadoEntregaNotificacion.FALLIDA);
        expect(entregaActualizada.proximoIntentoEn).toBeNull();
        expect(entregaActualizada.ultimoError).toBe(`[NDR Asíncrono] ${diagnostico}`);
      } finally {
        await prisma.entregaNotificacion.delete({ where: { id: entrega.id } });
        await prisma.notificacion.delete({ where: { id: notif.id } });
        await prisma.usuario.delete({ where: { id: usuario.id } });
      }
    });

    it('procesarRebotesEntrantes retorna 0 procesados sin error cuando IMAP_ENABLED=false', async () => {
      const res = await procesarRebotesEntrantes();
      expect(res.procesados).toBe(0);
      expect(res.actualizados).toBe(0);
      expect(res.errores).toEqual([]);
    });
  });
});
