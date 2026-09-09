import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
import path from 'path';
import { prisma } from '../db';
import { renderAuditAssignmentMonthly } from '../modules/notificaciones/templates/audit_assignment_monthly';
import { generarQrBuffer } from '../modules/notificaciones/qr';
import { obtenerAdjuntoLogoCuadra } from '../modules/notificaciones/logo';

// Cargar variables de entorno de backend/.env
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const host = process.env.SMTP_HOST || 'smtp.office365.com';
const port = parseInt(process.env.SMTP_PORT || '587', 10);
const secure = process.env.SMTP_SECURE === 'true'; // false para 587 (STARTTLS)
const user = process.env.SMTP_USER || '';
const pass = process.env.SMTP_PASS || '';
const from = process.env.SMTP_FROM || user;

const emailEnabled = process.env.EMAIL_ENABLED === 'true';

// Sanitizador de texto para ocultar contraseñas o tokens sensibles en logs
function sanitizarMensaje(str: string): string {
  if (!str) return '';
  let cleaned = str;
  if (pass) {
    cleaned = cleaned.replace(new RegExp(escapeRegExp(pass), 'g'), '********');
  }
  return cleaned;
}

function escapeRegExp(string: string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Resuelve el nombre real del usuario respetando la jerarquía:
 * 1. nombre completo en BD (prisma.usuario.nombre)
 * 2. display name formateado desde el usuario/correo (ej. joel.rodriguez -> Joel Rodriguez)
 * 3. correo electrónico
 */
async function resolverNombreRealUsuario(correo: string): Promise<string> {
  if (!correo) return 'Usuario';
  try {
    const usuarioBd = await prisma.usuario.findFirst({
      where: { correo: { equals: correo } },
      select: { nombre: true },
    });
    if (usuarioBd?.nombre && usuarioBd.nombre.trim()) {
      return usuarioBd.nombre.trim();
    }
  } catch {
    // Si la BD no está accesible durante el test rápido, continúa al fallback inteligente
  }

  const localPart = correo.split('@')[0] || '';
  if (localPart) {
    const partes = localPart
      .split(/[._-]/)
      .filter(Boolean)
      .map((palabra) => palabra.charAt(0).toUpperCase() + palabra.slice(1).toLowerCase());
    if (partes.length > 0) {
      return partes.join(' ');
    }
  }

  return correo;
}

function analizarErrorSmtp(err: unknown): { motivo: string; detalleEstructurado: Record<string, unknown> } {
  const errorObj = err as Record<string, unknown> | null | undefined;
  const rawMessage = sanitizarMensaje(String(errorObj?.message ?? err));
  const code = errorObj?.code || errorObj?.responseCode;
  const response = sanitizarMensaje(String(errorObj?.response ?? ''));

  let motivo = 'otro';

  if (
    response.includes('5.7.139') ||
    response.includes('SmtpClientAuthentication is disabled') ||
    rawMessage.includes('SmtpClientAuthentication is disabled')
  ) {
    motivo = 'SMTP AUTH deshabilitado en el tenant de Microsoft 365';
  } else if (
    response.includes('535') ||
    response.includes('5.7.3') ||
    response.includes('Authentication unsuccessful') ||
    code === 'EAUTH'
  ) {
    motivo = 'autenticación rechazada (usuario o contraseña incorrectos, o se requiere contraseña de aplicación / MFA)';
  } else if (
    response.includes('SendAsDenied') ||
    response.includes('5.2.0') ||
    response.includes('554')
  ) {
    motivo = 'política de Microsoft (SendAsDenied - la dirección FROM debe coincidir con la cuenta autenticada USER)';
  } else if (
    code === 'ETIMEDOUT' ||
    code === 'ECONNREFUSED' ||
    code === 'ENOTFOUND' ||
    code === 'ESOCKET'
  ) {
    motivo = 'error de conexión de red o puerto bloqueado';
  }

  return {
    motivo,
    detalleEstructurado: {
      codigo: code || 'SIN_CODIGO',
      comando: errorObj?.command || 'N/A',
      respuestaSmtp: response || rawMessage,
    },
  };
}

async function ejecutar() {
  const comando = process.argv[2] || 'verify';

  console.log('\n============================================================');
  console.log('  DIAGNÓSTICO SMTP MICROSOFT 365 — PRUEBA CONTROLADA HTML');
  console.log('============================================================\n');

  // Verificaciones de Seguridad
  console.log('🔍 [SEGURIDAD] Verificando pre-condiciones:');
  console.log(`   • EMAIL_ENABLED = ${process.env.EMAIL_ENABLED || 'false'} ${emailEnabled ? '⚠️ (¡DEBE SER false!)' : '✅ (Deshabilitado)'}`);
  console.log(`   • SMTP_HOST     = ${host}`);
  console.log(`   • SMTP_PORT     = ${port} (${secure ? 'TLS directo' : 'STARTTLS'})`);
  console.log(`   • SMTP_USER     = ${user ? user : '❌ NO CONFIGURADO'}`);
  console.log(`   • SMTP_PASS     = ${pass ? '******** (Configurada)' : '❌ NO CONFIGURADA'}`);
  console.log(`   • SMTP_FROM     = ${from || 'N/A'}\n`);

  if (emailEnabled) {
    console.error('❌ ABORTADO: EMAIL_ENABLED debe estar en "false" para la prueba.');
    process.exit(1);
  }

  if (!user || !pass) {
    console.error('❌ ABORTADO: Faltan credenciales en backend/.env (SMTP_USER y/o SMTP_PASS).');
    console.error('👉 Agrega tus credenciales corporativas en backend/.env y vuelve a ejecutar.');
    process.exit(1);
  }

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure, // false para 587 (STARTTLS)
    requireTLS: true,
    auth: {
      user,
      pass,
    },
  });

  if (comando === 'verify' || comando === 'prueba1') {
    console.log('📡 PRUEBA 1 — CONEXIÓN Y AUTENTICACIÓN (Sin envío de correo)...');
    try {
      await transporter.verify();
      console.log('\n✅ SMTP: CONECTADO');
      console.log('🎉 Microsoft 365 ha aceptado exitosamente las credenciales SMTP.\n');
      console.log('👉 Puedes proceder con la PRUEBA 2 HTML (envío de un solo correo a ti mismo) ejecutando:');
      console.log('   bun src/scripts/probador-smtp.ts send\n');
    } catch (err) {
      console.log('\n❌ SMTP: RECHAZADO\n');
      const { motivo, detalleEstructurado } = analizarErrorSmtp(err);
      console.log(`Motivo: ${motivo}`);
      console.log('\nDetalle Técnico Estructurado:');
      console.log(JSON.stringify(detalleEstructurado, null, 2));
      console.log('\n------------------------------------------------------------');
      console.log('💡 Ninguna contraseña fue expuesta en este diagnóstico.');
      console.log('------------------------------------------------------------\n');
    }
  } else if (comando === 'send' || comando === 'prueba2') {
    console.log('📡 PRUEBA 1 — Verificando conexión previa...');
    try {
      await transporter.verify();
      console.log('✅ SMTP: CONECTADO\n');
    } catch (err) {
      console.log('❌ SMTP: RECHAZADO');
      const { motivo, detalleEstructurado } = analizarErrorSmtp(err);
      console.log(`Motivo: ${motivo}`);
      console.log(JSON.stringify(detalleEstructurado, null, 2));
      console.log('\n❌ Se cancela la PRUEBA 2 debido a que la autenticación falló.');
      process.exit(1);
    }

    const nombreReal = await resolverNombreRealUsuario(user);

    console.log(`📧 PRUEBA 2 HTML — ENVIANDO UN SOLO CORREO DE PRUEBA REAL...`);
    console.log(`   FROM:           ${from}`);
    console.log(`   TO:             ${user} (Restringido estrictamente a tu mismo correo)`);
    console.log(`   NOMBRE SALUDO:  "${nombreReal}"`);
    console.log(`   TEMPLATE:       renderAuditAssignmentMonthly (v1)`);
    console.log(`   LOGO CUADRA:    CID "cid:logo-cuadra" (public/img/01_Cuadra.png)`);
    console.log(`   ASUNTO:         [PRUEBA CONTROLADA] Auditorías asignadas · Septiembre 2026\n`);

    const sampleUrl = process.env.APP_PUBLIC_URL
      ? `${process.env.APP_PUBLIC_URL}/mis-auditorias`
      : 'http://localhost:5173/mis-auditorias';

    const renderResult = renderAuditAssignmentMonthly({
      templateName: 'audit_assignment_monthly',
      templateVersion: 'v1',
      auditorNombre: nombreReal,
      mes: '2026-09',
      mesEtiqueta: 'Septiembre 2026',
      areas: ['BORDADO', 'MANTENIMIENTO', 'LASER', 'PPCP - MAQUILA'],
      urlMisAuditorias: sampleUrl,
    });

    const attachments = [];

    // 1. Adjunto inline CID para el Logo de Cuadra
    const logoAttachment = obtenerAdjuntoLogoCuadra();
    if (logoAttachment) {
      attachments.push(logoAttachment);
    }

    // 2. Adjunto inline CID para el Código QR
    try {
      const qrBuffer = await generarQrBuffer(sampleUrl);
      attachments.push({
        filename: 'qr-code.png',
        content: qrBuffer,
        cid: 'qr-code',
        contentType: 'image/png',
        contentDisposition: 'inline' as const,
      });
    } catch {
      // Continuar si falla la generación de QR
    }

    const mailOptions = {
      from,
      to: user, // Estrictamente forzado al correo corporativo del usuario
      subject: '[PRUEBA CONTROLADA] Auditorías asignadas · Septiembre 2026',
      html: renderResult.html,
      text: renderResult.text,
      attachments,
    };

    try {
      const info = await transporter.sendMail(mailOptions);
      console.log('✅ CORREO HTML DE PRUEBA ENVIADO CON ÉXITO');
      console.log(`   ID de Mensaje: ${info.messageId}`);
      console.log(`   Respuesta Servidor: ${sanitizarMensaje(info.response)}`);
      console.log('\n🎉 Revisa tu bandeja de entrada en Outlook para comprobar el renderizado HTML con el logo de Cuadra, saludo con nombre real y paleta corporativa.\n');
    } catch (err) {
      console.log('❌ FALLÓ EL ENVÍO DEL CORREO HTML DE PRUEBA\n');
      const { motivo, detalleEstructurado } = analizarErrorSmtp(err);
      console.log(`Motivo: ${motivo}`);
      console.log(JSON.stringify(detalleEstructurado, null, 2));
    } finally {
      await prisma.$disconnect().catch(() => {});
    }
  } else {
    console.log('Comando no reconocido. Utiliza:');
    console.log('  bun src/scripts/probador-smtp.ts verify   (Prueba 1: Conexión/Auth)');
    console.log('  bun src/scripts/probador-smtp.ts send     (Prueba 2 HTML: Envío a ti mismo con plantilla real)');
  }
}

ejecutar();
