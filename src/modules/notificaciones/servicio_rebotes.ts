import { ImapFlow } from 'imapflow';
import type { ParsedMail } from 'mailparser';
import { simpleParser } from 'mailparser';
import { env } from '../../config/env';
import { prisma } from '../../db';
import { EstadoEntregaNotificacion } from '../../generated/prisma/enums';

export interface ResultadoProcesamientoRebotes {
  procesados: number;
  actualizados: number;
  errores: string[];
}

/**
 * Normaliza un Message-ID extrayendo espacios y corchetes, y genera una lista
 * de candidatos con y sin corchetes para buscar en la base de datos de manera infalible.
 */
export const normalizarCandidatosMessageId = (rawId: string): string[] => {
  const limpio = rawId.replace(/^<|>$/g, '').trim();
  if (!limpio) return [];
  return Array.from(new Set([limpio, `<${limpio}>`]));
};

/**
 * Determina si un correo recibido es potencialmente un NDR (Non-Delivery Report)
 * proveniente de Microsoft Exchange, Outlook o servidores SMTP estándar.
 */
export const esPosibleNdr = (remitente?: string, asunto?: string): boolean => {
  const remitenteLimpio = (remitente || '').toLowerCase();
  const asuntoLimpio = (asunto || '').toLowerCase();

  const remitentesNdr = [
    'postmaster@',
    'mailer-daemon@',
    'system administrator',
    'administrador del sistema',
    'microsoft outlook',
    'mail delivery subsystem',
  ];

  const asuntosNdr = [
    'undeliverable',
    'no se pudo entregar',
    'delivery status notification',
    'failure notice',
    'mail delivery failed',
    'returned mail',
    'undelivered mail',
    'aviso de no entrega',
    'no entregado',
    'fallo de entrega',
  ];

  const coincideRemitente = remitentesNdr.some((r) => remitenteLimpio.includes(r));
  const coincideAsunto = asuntosNdr.some((a) => asuntoLimpio.includes(a));

  return coincideRemitente || coincideAsunto;
};

/**
 * Extrae el Message-ID del mensaje original rebotado analizando:
 * 1. Cabecera In-Reply-To
 * 2. Cabecera References
 * 3. Adjuntos MIME (message/delivery-status, message/rfc822, details.txt)
 * 4. Cuerpo de texto y HTML con expresiones regulares especializadas en Exchange y RFC 3464
 */
export const extraerMessageIdOriginal = (parsed: ParsedMail): string | null => {
  // 1. Cabecera In-Reply-To
  if (parsed.inReplyTo && typeof parsed.inReplyTo === 'string') {
    const id = parsed.inReplyTo.trim();
    if (id && id.length > 3) return id;
  }

  // 2. Cabecera References
  if (parsed.references) {
    const refs = Array.isArray(parsed.references) ? parsed.references : [parsed.references];
    for (const ref of refs) {
      if (typeof ref === 'string' && ref.trim().length > 3) {
        return ref.trim();
      }
    }
  }

  // 3. Adjuntos MIME
  if (parsed.attachments && parsed.attachments.length > 0) {
    for (const att of parsed.attachments) {
      const contenido = att.content ? att.content.toString('utf8') : '';
      const matchAtt = contenido.match(/(?:Original-)?Message-ID:\s*(<[^>\r\n]+>|[^\s\r\n<>]+)/i);
      if (matchAtt && matchAtt[1]) {
        return matchAtt[1].trim();
      }
    }
  }

  // 4. Cuerpos de texto plano y HTML
  const cuerpos = [parsed.text || '', parsed.html || ''];
  for (const cuerpo of cuerpos) {
    const matchCuerpo = cuerpo.match(/(?:Original-)?Message-ID:\s*(<[^>\r\n]+>|[^\s\r\n<>]+)/i);
    if (matchCuerpo && matchCuerpo[1]) {
      return matchCuerpo[1].trim();
    }
  }

  return null;
};

/**
 * Extrae el diagnóstico o motivo del rechazo del destinatario.
 * Prioriza respuestas explícitas de Exchange / SMTP (550, Diagnostic-Code, User unknown).
 */
export const extraerDiagnosticoNdr = (parsed: ParsedMail): string => {
  const fuentes = [
    parsed.text || '',
    parsed.html || '',
    ...(parsed.attachments || []).map((a) => (a.content ? a.content.toString('utf8') : '')),
  ];
  const textoUnido = fuentes.join('\n');

  // 1. Patrón específico de Exchange: Remote server returned '550 ...'
  const matchExchange = textoUnido.match(/Remote server returned\s*['"]([^'"]+)['"]/i);
  if (matchExchange && matchExchange[1].trim()) {
    return matchExchange[1].trim();
  }

  // 2. Patrón RFC 3464 Diagnostic-Code: smtp; ...
  const matchDiagnostic = textoUnido.match(/Diagnostic-Code:\s*(?:smtp;\s*)?([^\r\n]+)/i);
  if (matchDiagnostic && matchDiagnostic[1].trim()) {
    return matchDiagnostic[1].trim();
  }

  // 3. Patrón de código SMTP 5xx con código de estado RFC 3463 (ej: 550 5.1.1 User unknown)
  const matchSmtpCode = textoUnido.match(/\b(5\d{2}\s+5\.\d+\.\d+\s+[^\r\n<]{5,100})/i);
  if (matchSmtpCode && matchSmtpCode[1].trim()) {
    return matchSmtpCode[1].trim();
  }

  // 4. Frases estándar reconocidas en español o inglés
  const frasesConocidas = [
    /No se encontr[oó] la direcci[oó]n de correo electr[oó]nico/i,
    /El buz[oó]n de correo no est[aá] disponible/i,
    /Recipient not found/i,
    /User unknown/i,
    /Mailbox unavailable/i,
    /Address rejected/i,
    /Host or domain name not found/i,
  ];

  for (const regex of frasesConocidas) {
    const matchFrase = textoUnido.match(regex);
    if (matchFrase) {
      return matchFrase[0].trim();
    }
  }

  return 'Rebote recibido del servidor de destino (NDR - Dirección no válida o no encontrada)';
};

/**
 * Escanea el buzón IMAP en busca de correos no leídos de rebote (NDR),
 * correlaciona el Message-ID original con entregas en estado ENVIADA y las actualiza a FALLIDA.
 */
export const procesarRebotesEntrantes = async (): Promise<ResultadoProcesamientoRebotes> => {
  if (!env.IMAP_ENABLED) {
    return { procesados: 0, actualizados: 0, errores: [] };
  }

  const imapUser = env.IMAP_USER || env.SMTP_USER;
  const imapPass = env.IMAP_PASS || env.SMTP_PASS;

  if (!imapUser || !imapPass) {
    console.warn('[NDR IMAP] IMAP_ENABLED está activo pero no se configuraron credenciales IMAP_USER ni SMTP_USER.');
    return { procesados: 0, actualizados: 0, errores: ['Credenciales IMAP no configuradas'] };
  }

  const client = new ImapFlow({
    host: env.IMAP_HOST,
    port: env.IMAP_PORT,
    secure: env.IMAP_SECURE,
    auth: {
      user: imapUser,
      pass: imapPass,
    },
    logger: false,
  });

  let procesados = 0;
  let actualizados = 0;
  const errores: string[] = [];

  try {
    await client.connect();
    const lock = await client.getMailboxLock('INBOX');

    try {
      const uids = await client.search({ seen: false }, { uid: true });
      if (!uids || (Array.isArray(uids) && uids.length === 0)) {
        return { procesados: 0, actualizados: 0, errores: [] };
      }

      console.log(`[NDR IMAP] ${uids.length} correo(s) no leído(s) encontrados en INBOX. Verificando rebotes...`);

      for await (const message of client.fetch(uids, { source: true, envelope: true, uid: true }, { uid: true })) {
        try {
          if (!message.source) continue;

          const remitente = message.envelope?.from?.[0]?.address || message.envelope?.from?.[0]?.name || '';
          const asunto = message.envelope?.subject || '';

          if (!esPosibleNdr(remitente, asunto)) {
            // Correo regular del usuario; no tocar ni marcar como leído
            continue;
          }

          procesados++;
          const parsed = await simpleParser(message.source);
          const messageIdOriginal = extraerMessageIdOriginal(parsed);
          const diagnostico = extraerDiagnosticoNdr(parsed);

          if (messageIdOriginal) {
            const candidatos = normalizarCandidatosMessageId(messageIdOriginal);
            const resultadoDb = await prisma.entregaNotificacion.updateMany({
              where: {
                idMensajeExterno: { in: candidatos },
                estado: EstadoEntregaNotificacion.ENVIADA,
              },
              data: {
                estado: EstadoEntregaNotificacion.FALLIDA,
                proximoIntentoEn: null,
                ultimoError: `[NDR Asíncrono] ${diagnostico.slice(0, 500)}`,
              },
            });

            if (resultadoDb.count > 0) {
              actualizados += resultadoDb.count;
              console.log(
                `[NDR IMAP] Entrega con Message-ID '${messageIdOriginal}' marcada como FALLIDA (${resultadoDb.count} registro(s)). Diagnóstico: ${diagnostico}`
              );
            } else {
              console.log(
                `[NDR IMAP] Rebote reconocido con Message-ID '${messageIdOriginal}', sin entregas coincidentes en estado ENVIADA.`
              );
            }
          } else {
            console.warn(`[NDR IMAP] Rebote detectado (Asunto: "${asunto}"), pero no se pudo extraer el Message-ID original.`);
          }

          // Marcar el rebote como leído para no re-procesarlo en las siguientes rondas
          if (message.uid) {
            await client.messageFlagsAdd(message.uid, ['\\Seen'], { uid: true });
          }
        } catch (msgErr) {
          const errMsg = msgErr instanceof Error ? msgErr.message : String(msgErr);
          errores.push(`UID ${message.uid}: ${errMsg}`);
          console.error(`[NDR IMAP] Error procesando correo UID ${message.uid}:`, msgErr);
        }
      }
    } finally {
      lock.release();
    }
  } catch (connectionError) {
    const errMsg = connectionError instanceof Error ? connectionError.message : String(connectionError);
    console.error('[NDR IMAP] Error de conexión IMAP:', errMsg);
    errores.push(`Conexión: ${errMsg}`);
  } finally {
    await client.logout().catch(() => undefined);
  }

  return { procesados, actualizados, errores };
};
