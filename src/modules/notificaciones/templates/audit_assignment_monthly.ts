export type MonthlyAssignmentsData = {
  templateName: 'audit_assignment_monthly';
  templateVersion: 'v1';
  auditorNombre: string;
  mes: string;
  mesEtiqueta: string;
  areas: string[];
  urlMisAuditorias: string;
  esActualizacion?: boolean;
};

export type TemplateRenderResult = {
  subject: string;
  html: string;
  text: string;
  qrUrl?: string;
};

const escapeHtml = (text?: string | null): string => {
  if (!text) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
};

export const renderAuditAssignmentMonthly = (data: MonthlyAssignmentsData): TemplateRenderResult => {
  const esActualizacion = Boolean(data.esActualizacion);
  const subject = esActualizacion
    ? `Actualización de asignaciones — ${data.mesEtiqueta}`
    : `Auditorías asignadas — ${data.mesEtiqueta}`;
  const nombreSeguro = escapeHtml(data.auditorNombre);
  const mesSeguro = escapeHtml(data.mesEtiqueta);

  const tituloEncabezado = esActualizacion
    ? `Actualización de Asignaciones — ${mesSeguro}`
    : `Asignación de Auditorías — ${mesSeguro}`;

  const parrafoIntro = esActualizacion
    ? `Se ha actualizado tu programación de auditorías de 5S correspondientes a <strong>${mesSeguro}</strong>. A continuación se listan las áreas que actualmente tienes asignadas:`
    : `Se han programado tus auditorías correspondientes a <strong>${mesSeguro}</strong>. A continuación se listan las áreas que te corresponde evaluar durante este período:`;

  const filasAreasHtml = data.areas
    .map(
      (area, index) => `
        <tr style="border-top: 1px solid #f4f4f5;">
          <td style="padding: 11px 16px; font-size: 13px; font-weight: 600; color: #71717a; width: 40px; text-align: center; border-right: 1px solid #f4f4f5;">${index + 1}</td>
          <td style="padding: 11px 16px; font-size: 13px; font-weight: 700; color: #18181b; text-transform: uppercase; letter-spacing: 0.02em;">${escapeHtml(area)}</td>
        </tr>
      `
    )
    .join('');

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(subject)}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f4f4f5; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; -webkit-font-smoothing: antialiased; color: #18181b;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: #f4f4f5; padding: 32px 16px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width: 580px; background-color: #ffffff; border: 1px solid #e4e4e7; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.04);">
          <!-- Header Institucional Cuadra -->
          <tr>
            <td align="center" style="background-color: #ffffff; padding: 28px 24px 20px 24px; border-bottom: 1px solid #e4e4e7;">
              <img src="cid:logo-cuadra" alt="Cuadra" width="160" style="display: block; margin: 0 auto; border: 0; outline: none; text-decoration: none; width: 160px; max-width: 100%; height: auto;" />
              <div style="margin-top: 14px; font-size: 11px; font-weight: 800; color: #71717a; text-transform: uppercase; letter-spacing: 0.15em;">
                Sistema de Encuestas 5S
              </div>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding: 32px 32px 28px 32px; background-color: #ffffff;">
              <h1 style="margin: 0 0 20px 0; font-size: 20px; font-weight: 800; color: #18181b; letter-spacing: -0.02em; line-height: 1.3;">
                ${tituloEncabezado}
              </h1>

              <p style="margin: 0 0 16px 0; font-size: 15px; color: #27272a; line-height: 1.6;">
                Hola <strong>${nombreSeguro}</strong>,
              </p>

              <p style="margin: 0 0 24px 0; font-size: 14px; color: #52525b; line-height: 1.6;">
                ${parrafoIntro}
              </p>

              <!-- Tabla de Áreas -->
              <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin: 20px 0 28px 0; border: 1px solid #e4e4e7; border-radius: 8px; border-collapse: separate; overflow: hidden; background-color: #ffffff;">
                <thead>
                  <tr style="background-color: #fafafa;">
                    <th style="padding: 10px 16px; font-size: 11px; font-weight: 700; color: #71717a; text-transform: uppercase; letter-spacing: 0.08em; width: 40px; text-align: center; border-bottom: 1px solid #e4e4e7;">#</th>
                    <th style="padding: 10px 16px; font-size: 11px; font-weight: 700; color: #71717a; text-transform: uppercase; letter-spacing: 0.08em; text-align: left; border-bottom: 1px solid #e4e4e7;">Área / Departamento</th>
                  </tr>
                </thead>
                <tbody>
                  ${filasAreasHtml}
                </tbody>
              </table>

              <!-- Botón CTA -->
              <div style="text-align: center; margin: 32px 0 28px 0;">
                <a href="${data.urlMisAuditorias}" style="display: inline-block; background-color: #18181b; color: #ffffff; padding: 13px 32px; font-size: 14px; font-weight: 700; text-decoration: none; border-radius: 6px; box-shadow: 0 2px 4px rgba(0,0,0,0.08);">
                  Ir a Mis Auditorías &rarr;
                </a>
              </div>

              <!-- Sección QR -->
              <div style="margin-top: 32px; padding-top: 24px; border-top: 1px solid #e4e4e7; text-align: center;">
                <p style="margin: 0 0 14px 0; font-size: 12px; font-weight: 700; color: #52525b; text-transform: uppercase; letter-spacing: 0.06em;">
                  O escanea el código QR desde tu dispositivo móvil
                </p>
                <div style="display: inline-block; padding: 10px; background-color: #ffffff; border: 1px solid #e4e4e7; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.04);">
                  <img src="cid:qr-code" alt="Código QR para acceso a auditorías" width="150" height="150" style="display: block; margin: 0 auto; border: 0; width: 150px; height: 150px;" />
                </div>
              </div>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color: #fafafa; padding: 20px 32px; border-top: 1px solid #e4e4e7; text-align: center;">
              <p style="margin: 0; font-size: 12px; color: #71717a; line-height: 1.5;">
                Este es un aviso automático generado por el Sistema de Encuestas 5S de Cuadra.
              </p>
              <p style="margin: 4px 0 0 0; font-size: 12px; color: #a1a1aa;">
                Por favor no respondas a este correo.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const areasTexto = data.areas.map((a, i) => `  ${i + 1}. ${a}`).join('\n');
  const text = `CUADRA — SISTEMA DE ENCUESTAS 5S
${esActualizacion ? 'ACTUALIZACIÓN DE ASIGNACIONES' : 'ASIGNACIÓN DE AUDITORÍAS'} (${data.mesEtiqueta})
================================================

Hola ${data.auditorNombre},

${esActualizacion ? `Se ha actualizado tu programación de auditorías de 5S correspondientes a ${data.mesEtiqueta}. A continuación se listan las áreas que actualmente tienes asignadas:` : `Se han programado tus auditorías correspondientes a ${data.mesEtiqueta}. A continuación se listan las áreas que te corresponde evaluar:`}

${areasTexto}

Para ingresar al sistema y realizar tus auditorías:
${data.urlMisAuditorias}

------------------------------------------------
Este es un aviso automático generado por el Sistema de Encuestas 5S de Cuadra.
Por favor no respondas a este correo.
`;

  return {
    subject,
    html,
    text,
    qrUrl: data.urlMisAuditorias,
  };
};