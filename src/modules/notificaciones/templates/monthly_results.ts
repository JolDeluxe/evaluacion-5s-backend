export type MonthlyResultsData = {
  templateName: 'monthly_results';
  templateVersion: 'v1';
  destinatarioNombre: string;
  mes: string;
  mesEtiqueta: string;
  areas: Array<{
    nombre: string;
    resultado: number | null;
  }>;
  resultadoGeneral: number | null;
  urlResultados: string;
  urlDescargaPdf?: string;
};

export type TemplateRenderResult = {
  subject: string;
  html: string;
  text: string;
  qrUrl?: string;
};

const formatPct = (val: number | null | undefined): string => {
  if (val === null || val === undefined || Number.isNaN(Number(val))) return '—';
  return `${Number(val).toFixed(1)}%`;
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

const getSemaforoStyle = (calif: number | null | undefined): { text: string; bg: string } | null => {
  if (calif === null || calif === undefined || Number.isNaN(Number(calif))) {
    return null;
  }
  const ratio = calif > 1 ? calif / 100 : calif;
  if (ratio >= 0.90) return { text: '#15803d', bg: '#dcfce7' };
  if (ratio >= 0.70) return { text: '#a16207', bg: '#fef9c3' };
  if (ratio >= 0.50) return { text: '#c2410c', bg: '#ffedd5' };
  return { text: '#b91c1c', bg: '#fee2e2' };
};

export const renderMonthlyResults = (data: MonthlyResultsData): TemplateRenderResult => {
  const subject = `Resultados 5S — ${data.mesEtiqueta}`;
  const nombreSeguro = escapeHtml(data.destinatarioNombre);
  const mesSeguro = escapeHtml(data.mesEtiqueta);
  const urlPdfSegura = data.urlDescargaPdf || (data.urlResultados.includes('?') ? `${data.urlResultados}&descargar=pdf` : `${data.urlResultados}?descargar=pdf`);

  const generalPctStr = formatPct(data.resultadoGeneral);
  const semGeneral = getSemaforoStyle(data.resultadoGeneral);

  const tieneAreas = data.areas && data.areas.length > 0;

  const filasAreasHtml = tieneAreas
    ? data.areas
        .map((area, index) => {
          const scoreStr = formatPct(area.resultado);
          const semArea = getSemaforoStyle(area.resultado);

          const badgeStyle = semArea
            ? `display: inline-block; padding: 3px 10px; border-radius: 6px; font-size: 13px; font-weight: 800; color: ${semArea.text}; background-color: ${semArea.bg};`
            : 'display: inline-block; font-size: 14px; font-weight: 800; color: #a1a1aa;';

          return `
            <tr style="border-top: 1px solid #f4f4f5;">
              <td style="padding: 11px 16px; font-size: 13px; font-weight: 600; color: #71717a; width: 40px; text-align: center; border-right: 1px solid #f4f4f5;">${index + 1}</td>
              <td style="padding: 11px 16px; font-size: 13px; font-weight: 700; color: #18181b; text-transform: uppercase; letter-spacing: 0.02em;">${escapeHtml(area.nombre)}</td>
              <td style="padding: 11px 16px; text-align: right; white-space: nowrap;">
                <span style="${badgeStyle}">${scoreStr}</span>
              </td>
            </tr>
          `;
        })
        .join('')
    : '';

  const bloqueAreasHtml = tieneAreas
    ? `
      <div style="margin-top: 24px;">
        <h3 style="margin: 0 0 12px 0; font-size: 12px; font-weight: 800; color: #52525b; text-transform: uppercase; letter-spacing: 0.08em;">
          Áreas bajo tu responsabilidad
        </h3>
        <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border: 1px solid #e4e4e7; border-radius: 8px; border-collapse: separate; overflow: hidden; background-color: #ffffff;">
          <thead>
            <tr style="background-color: #fafafa;">
              <th style="padding: 10px 16px; font-size: 11px; font-weight: 700; color: #71717a; text-transform: uppercase; letter-spacing: 0.08em; width: 40px; text-align: center; border-bottom: 1px solid #e4e4e7;">#</th>
              <th style="padding: 10px 16px; font-size: 11px; font-weight: 700; color: #71717a; text-transform: uppercase; letter-spacing: 0.08em; text-align: left; border-bottom: 1px solid #e4e4e7;">Área / Departamento</th>
              <th style="padding: 10px 16px; font-size: 11px; font-weight: 700; color: #71717a; text-transform: uppercase; letter-spacing: 0.08em; text-align: right; border-bottom: 1px solid #e4e4e7;">Calificación</th>
            </tr>
          </thead>
          <tbody>
            ${filasAreasHtml}
          </tbody>
        </table>
      </div>
    `
    : `
      <p style="margin: 20px 0 0 0; font-size: 14px; color: #52525b; line-height: 1.6; background-color: #fafafa; border: 1px solid #e4e4e7; border-radius: 8px; padding: 14px 18px;">
        Este informe contiene los resultados generales consolidados para el período de <strong>${mesSeguro}</strong>. Se anexa el documento oficial en formato PDF.
      </p>
    `;

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
                Resultados Mensuales 5S — ${mesSeguro}
              </h1>

              <p style="margin: 0 0 16px 0; font-size: 15px; color: #27272a; line-height: 1.6;">
                Hola <strong>${nombreSeguro}</strong>,
              </p>

              <p style="margin: 0 0 24px 0; font-size: 14px; color: #52525b; line-height: 1.6;">
                Ya se encuentran disponibles los resultados finales consolidados de las auditorías de 5S correspondientes a <strong>${mesSeguro}</strong>. Se ha adjuntado el informe en formato PDF a este mensaje.
              </p>

              <!-- Tarjeta de Resultados Generales -->
              <div style="background-color: #fafafa; border: 1px solid #e4e4e7; border-radius: 10px; padding: 20px 24px; margin: 20px 0 24px 0;">
                <table width="100%" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td style="vertical-align: middle;">
                      <div style="font-size: 13px; font-weight: 800; color: #18181b; text-transform: uppercase; letter-spacing: 0.06em;">
                        Resultados Generales 5S
                      </div>
                    </td>
                    <td style="vertical-align: middle; text-align: right;">
                      <div style="font-size: 28px; font-weight: 900; color: ${semGeneral ? semGeneral.text : '#71717a'}; letter-spacing: -0.02em; line-height: 1;">
                        ${generalPctStr}
                      </div>
                    </td>
                  </tr>
                </table>
              </div>

              ${bloqueAreasHtml}

              <!-- Botones CTA -->
              <div style="text-align: center; margin: 32px 0 28px 0;">
                <a href="${data.urlResultados}" style="display: inline-block; background-color: #18181b; color: #ffffff; padding: 13px 26px; font-size: 13px; font-weight: 700; text-decoration: none; border-radius: 6px; box-shadow: 0 2px 4px rgba(0,0,0,0.08); margin: 6px 6px;">
                  VER RESULTADOS &rarr;
                </a>
                <a href="${urlPdfSegura}" style="display: inline-block; background-color: #ffffff; color: #18181b; border: 1.5px solid #18181b; padding: 11.5px 24px; font-size: 13px; font-weight: 700; text-decoration: none; border-radius: 6px; box-shadow: 0 1px 2px rgba(0,0,0,0.04); margin: 6px 6px;">
                  DESCARGAR PDF &#x2193;
                </a>
              </div>

              <!-- Sección QR -->
              <div style="margin-top: 32px; padding-top: 24px; border-top: 1px solid #e4e4e7; text-align: center;">
                <p style="margin: 0 0 14px 0; font-size: 12px; font-weight: 700; color: #52525b; text-transform: uppercase; letter-spacing: 0.06em;">
                  O escanea el código QR desde tu dispositivo móvil
                </p>
                <div style="display: inline-block; padding: 10px; background-color: #ffffff; border: 1px solid #e4e4e7; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.04);">
                  <img src="cid:qr-code" alt="Código QR para acceso a resultados" width="150" height="150" style="display: block; margin: 0 auto; border: 0; width: 150px; height: 150px;" />
                </div>
              </div>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color: #fafafa; padding: 20px 32px; border-top: 1px solid #e4e4e7; text-align: center;">
              <p style="margin: 0; font-size: 12px; color: #71717a; line-height: 1.5;">
                Este es un informe oficial emitido por el Sistema de Encuestas 5S de Cuadra.
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

  const areasTexto = tieneAreas
    ? data.areas
        .map((a, i) => `  ${i + 1}. ${a.nombre}: ${formatPct(a.resultado)}`)
        .join('\n')
    : '';

  const text = `CUADRA — SISTEMA DE ENCUESTAS 5S
RESULTADOS MENSUALES (${data.mesEtiqueta})
============================================================

Hola ${data.destinatarioNombre},

Están listos los resultados de las auditorías de 5S para ${data.mesEtiqueta}.
Se anexa el reporte oficial consolidado en formato PDF.

Resultados Generales 5S: ${generalPctStr}
${tieneAreas ? `\nÁreas bajo tu responsabilidad:\n${areasTexto}\n` : ''}
Para consultar el detalle interactivo completo con hallazgos y evidencias:
${data.urlResultados}

Para descargar una copia del reporte oficial en PDF:
${urlPdfSegura}

------------------------------------------------------------
Este es un informe oficial emitido por el Sistema de Encuestas 5S de Cuadra.
Por favor no respondas a este correo.
`;

  return {
    subject,
    html,
    text,
    qrUrl: data.urlResultados,
  };
};