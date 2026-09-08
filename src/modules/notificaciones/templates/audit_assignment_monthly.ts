export type MonthlyAssignmentsData = {
  templateName: 'audit_assignment_monthly';
  templateVersion: 'v1';
  auditorNombre: string;
  mes: string;
  mesEtiqueta: string;
  areas: string[];
  urlMisAuditorias: string;
};

export type TemplateRenderResult = {
  subject: string;
  html: string;
  text: string;
  qrUrl?: string;
};

const escapeHtml = (text: string): string => {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
};

export const renderAuditAssignmentMonthly = (data: MonthlyAssignmentsData): TemplateRenderResult => {
  const subject = `Auditorías asignadas — ${data.mesEtiqueta}`;
  const nombreSeguro = escapeHtml(data.auditorNombre);
  const mesSeguro = escapeHtml(data.mesEtiqueta);

  const filasAreasHtml = data.areas
    .map(
      (area, index) => `
        <tr style="border-top: 1px solid #f1f5f9;">
          <td style="padding: 10px 16px; font-size: 13px; font-weight: 600; color: #64748b; width: 36px; text-align: center;">${index + 1}</td>
          <td style="padding: 10px 16px; font-size: 14px; font-weight: 700; color: #0f172a; text-transform: uppercase;">${escapeHtml(area)}</td>
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
<body style="margin: 0; padding: 0; background-color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; -webkit-font-smoothing: antialiased; color: #1e293b;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f8fafc; padding: 32px 16px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width: 580px; background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);">
          <!-- Header -->
          <tr>
            <td style="background-color: #0f172a; padding: 24px 32px; text-align: left;">
              <div style="display: inline-block; background-color: rgba(255, 255, 255, 0.15); border-radius: 4px; padding: 4px 8px; font-size: 11px; font-weight: 800; color: #38bdf8; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 8px;">
                Encuestas 5S
              </div>
              <h1 style="margin: 0; font-size: 20px; font-weight: 800; color: #ffffff; letter-spacing: -0.025em;">
                Asignación de Auditorías
              </h1>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding: 32px;">
              <p style="margin: 0 0 16px 0; font-size: 15px; color: #334155; line-height: 1.5;">
                Hola <strong>${nombreSeguro}</strong>,
              </p>
              <p style="margin: 0 0 20px 0; font-size: 15px; color: #475569; line-height: 1.5;">
                Se han programado tus auditorías correspondientes a <strong>${mesSeguro}</strong>. A continuación se listan las áreas que te corresponde evaluar durante este período:
              </p>

              <!-- Tabla de Áreas -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin: 20px 0; border: 1px solid #e2e8f0; border-radius: 8px; border-collapse: separate; overflow: hidden;">
                <thead>
                  <tr style="background-color: #f8fafc;">
                    <th style="padding: 10px 16px; font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em; width: 36px; text-align: center;">#</th>
                    <th style="padding: 10px 16px; font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em; text-align: left;">Área / Departamento</th>
                  </tr>
                </thead>
                <tbody>
                  ${filasAreasHtml}
                </tbody>
              </table>

              <!-- CTA Button -->
              <div style="text-align: center; margin: 32px 0 24px 0;">
                <a href="${data.urlMisAuditorias}" style="display: inline-block; background-color: #0f172a; color: #ffffff; padding: 14px 32px; font-size: 14px; font-weight: 700; text-decoration: none; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                  Ir a Mis Auditorías &rarr;
                </a>
              </div>

              <!-- QR Code Section -->
              <div style="margin-top: 32px; padding-top: 24px; border-top: 1px solid #e2e8f0; text-align: center;">
                <p style="margin: 0 0 12px 0; font-size: 12px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em;">
                  O escanea el código QR desde tu celular
                </p>
                <div style="display: inline-block; padding: 8px; background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 8px;">
                  <img src="cid:qr-code" alt="Código QR para acceso rápido" width="160" height="160" style="display: block; margin: 0 auto; border: 0;" />
                </div>
              </div>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color: #f8fafc; padding: 20px 32px; border-top: 1px solid #e2e8f0; text-align: center;">
              <p style="margin: 0; font-size: 12px; color: #94a3b8; line-height: 1.5;">
                Este es un mensaje automático generado por el Sistema de Encuestas 5S.
              </p>
              <p style="margin: 4px 0 0 0; font-size: 12px; color: #94a3b8;">
                Por favor no respondas directamente a este correo.
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
  const text = `ENCUESTAS 5S — ASIGNACIÓN DE AUDITORÍAS
=======================================

Hola ${data.auditorNombre},

Se han programado tus auditorías correspondientes a ${data.mesEtiqueta}.
A continuación se listan las áreas que te corresponde evaluar:

${areasTexto}

Para ingresar al sistema y realizar tus auditorías:
${data.urlMisAuditorias}

---------------------------------------
Este es un mensaje automático del Sistema de Encuestas 5S.
Por favor no respondas a este correo.
`;

  return {
    subject,
    html,
    text,
    qrUrl: data.urlMisAuditorias,
  };
};