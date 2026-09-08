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
};

export type TemplateRenderResult = {
  subject: string;
  html: string;
  text: string;
  qrUrl?: string;
};

type SemaforoInfo = {
  label: string;
  color: string;
  textColor: string;
  bgColor: string;
  borderColor: string;
};

const getSemaforoInfo = (calificacion: number | null | undefined): SemaforoInfo => {
  if (calificacion === null || calificacion === undefined || Number.isNaN(Number(calificacion))) {
    return {
      label: 'Sin evaluar',
      color: '#94a3b8',
      textColor: '#475569',
      bgColor: '#f1f5f9',
      borderColor: '#e2e8f0',
    };
  }

  const num = Number(calificacion);
  const ratio = num > 1 ? num / 100 : num;

  if (ratio >= 0.90) {
    return {
      label: 'Excelente',
      color: '#22c55e',
      textColor: '#15803d',
      bgColor: '#dcfce7',
      borderColor: '#86efac',
    };
  }
  if (ratio >= 0.70) {
    return {
      label: 'Satisfactorio',
      color: '#eab308',
      textColor: '#a16207',
      bgColor: '#fef9c3',
      borderColor: '#fde047',
    };
  }
  if (ratio >= 0.50) {
    return {
      label: 'Requiere atención',
      color: '#f97316',
      textColor: '#c2410c',
      bgColor: '#ffedd5',
      borderColor: '#fdba74',
    };
  }
  return {
    label: 'Crítico',
    color: '#ef4444',
    textColor: '#b91c1c',
    bgColor: '#fee2e2',
    borderColor: '#fca5a5',
  };
};

const formatPct = (val: number | null | undefined): string => {
  if (val === null || val === undefined || Number.isNaN(Number(val))) return '—';
  return `${Number(val).toFixed(1)}%`;
};

const escapeHtml = (text: string): string => {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
};

export const renderMonthlyResults = (data: MonthlyResultsData): TemplateRenderResult => {
  const subject = `Resultados 5S — ${data.mesEtiqueta}`;
  const nombreSeguro = escapeHtml(data.destinatarioNombre);
  const mesSeguro = escapeHtml(data.mesEtiqueta);

  const semaforoGeneral = getSemaforoInfo(data.resultadoGeneral);
  const generalPctStr = formatPct(data.resultadoGeneral);

  const tieneAreas = data.areas && data.areas.length > 0;

  const filasAreasHtml = tieneAreas
    ? data.areas
        .map((area, index) => {
          const sem = getSemaforoInfo(area.resultado);
          const scoreStr = formatPct(area.resultado);
          return `
            <tr style="border-top: 1px solid #f1f5f9;">
              <td style="padding: 12px 16px; font-size: 13px; font-weight: 600; color: #64748b; width: 36px; text-align: center;">${index + 1}</td>
              <td style="padding: 12px 16px; font-size: 14px; font-weight: 700; color: #0f172a; text-transform: uppercase;">${escapeHtml(area.nombre)}</td>
              <td style="padding: 12px 16px; font-size: 15px; font-weight: 800; color: ${sem.textColor}; text-align: right; white-space: nowrap;">${scoreStr}</td>
              <td style="padding: 12px 16px; text-align: right; width: 130px;">
                <span style="display: inline-block; padding: 3px 8px; font-size: 11px; font-weight: 700; color: ${sem.textColor}; background-color: ${sem.bgColor}; border: 1px solid ${sem.borderColor}; border-radius: 9999px; text-transform: uppercase;">
                  ${sem.label}
                </span>
              </td>
            </tr>
          `;
        })
        .join('')
    : '';

  const bloqueAreasHtml = tieneAreas
    ? `
      <div style="margin-top: 24px;">
        <h3 style="margin: 0 0 12px 0; font-size: 13px; font-weight: 800; color: #475569; text-transform: uppercase; letter-spacing: 0.05em;">
          Tus Áreas Evaluadas
        </h3>
        <table width="100%" cellpadding="0" cellspacing="0" style="border: 1px solid #e2e8f0; border-radius: 8px; border-collapse: separate; overflow: hidden;">
          <thead>
            <tr style="background-color: #f8fafc;">
              <th style="padding: 10px 16px; font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em; width: 36px; text-align: center;">#</th>
              <th style="padding: 10px 16px; font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em; text-align: left;">Área / Departamento</th>
              <th style="padding: 10px 16px; font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em; text-align: right;">Calificación</th>
              <th style="padding: 10px 16px; font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em; text-align: right;">Nivel</th>
            </tr>
          </thead>
          <tbody>
            ${filasAreasHtml}
          </tbody>
        </table>
      </div>
    `
    : `
      <p style="margin: 16px 0 0 0; font-size: 14px; color: #64748b; line-height: 1.5;">
        Este informe contiene el resultado global consolidado de todas las áreas evaluadas en la organización para el período de ${mesSeguro}.
      </p>
    `;

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
                Resultados Mensuales
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
                Ya se encuentran disponibles los resultados finales de las auditorías de 5S correspondientes a <strong>${mesSeguro}</strong>:
              </p>

              <!-- Tarjeta de Resultado Global -->
              <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 20px 24px; margin: 20px 0;">
                <table width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="vertical-align: middle;">
                      <div style="font-size: 11px; font-weight: 800; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em;">
                        Resultado Global 5S
                      </div>
                      <div style="font-size: 13px; font-weight: 600; color: #334155; margin-top: 2px;">
                        Promedio de la organización
                      </div>
                    </td>
                    <td style="vertical-align: middle; text-align: right;">
                      <div style="font-size: 28px; font-weight: 900; color: ${semaforoGeneral.textColor}; letter-spacing: -0.02em;">
                        ${generalPctStr}
                      </div>
                      <span style="display: inline-block; padding: 2px 8px; font-size: 10px; font-weight: 700; color: ${semaforoGeneral.textColor}; background-color: ${semaforoGeneral.bgColor}; border: 1px solid ${semaforoGeneral.borderColor}; border-radius: 9999px; text-transform: uppercase; margin-top: 2px;">
                        ${semaforoGeneral.label}
                      </span>
                    </td>
                  </tr>
                </table>
              </div>

              ${bloqueAreasHtml}

              <!-- CTA Button -->
              <div style="text-align: center; margin: 32px 0 24px 0;">
                <a href="${data.urlResultados}" style="display: inline-block; background-color: #0f172a; color: #ffffff; padding: 14px 32px; font-size: 14px; font-weight: 700; text-decoration: none; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                  Ver Resultados Completos &rarr;
                </a>
              </div>

              <!-- QR Code Section -->
              <div style="margin-top: 32px; padding-top: 24px; border-top: 1px solid #e2e8f0; text-align: center;">
                <p style="margin: 0 0 12px 0; font-size: 12px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em;">
                  O escanea el código QR desde tu celular
                </p>
                <div style="display: inline-block; padding: 8px; background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 8px;">
                  <img src="cid:qr-code" alt="Código QR para acceso a resultados" width="160" height="160" style="display: block; margin: 0 auto; border: 0;" />
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

  const areasTexto = tieneAreas
    ? data.areas
        .map((a, i) => {
          const sem = getSemaforoInfo(a.resultado);
          return `  ${i + 1}. ${a.nombre}: ${formatPct(a.resultado)} (${sem.label})`;
        })
        .join('\n')
    : '';

  const text = `ENCUESTAS 5S — RESULTADOS MENSUALES
====================================

Hola ${data.destinatarioNombre},

Están listos los resultados de las auditorías de 5S para ${data.mesEtiqueta}.

Resultado Global: ${generalPctStr} (${semaforoGeneral.label})
${tieneAreas ? `\nTus Áreas Evaluadas:\n${areasTexto}\n` : ''}
Para consultar el detalle completo con hallazgos y gráficos:
${data.urlResultados}

------------------------------------
Este es un mensaje automático del Sistema de Encuestas 5S.
Por favor no respondas a este correo.
`;

  return {
    subject,
    html,
    text,
    qrUrl: data.urlResultados,
  };
};