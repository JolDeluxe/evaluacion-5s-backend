import fs from 'node:fs';
import path from 'node:path';
import PDFDocument from 'pdfkit';

type DatosPeriodo = {
  periodo?: number;
  numeroCorte?: number;
  porcentaje?: number | null;
  [key: string]: unknown;
};

type DatosArea = {
  area: { id: number; nombre: string; codigo?: string; tipo?: string; [key: string]: unknown };
  periodos?: DatosPeriodo[];
  resultadoMensual?: number | null;
  posicion?: number | null;
  [key: string]: unknown;
};

type DatosResultadosGeneral = {
  mes?: { clave?: string; etiqueta?: string };
  rango?: { tipo?: string; etiqueta?: string };
  resultadoGeneral?: number | null;
  ganadoresPorTipo?: {
    administrativo?: { resultado: number | null; areas?: Array<{ id: number; nombre: string }> };
    operativo?: { resultado: number | null; areas?: Array<{ id: number; nombre: string }> };
  };
  areas?: DatosArea[];
  [key: string]: unknown;
};

export const mapAreasConRankingCanonico = (areas: DatosArea[] = []): DatosArea[] => {
  let contadorPosicion = 1;

  return areas.map((item) => {
    const rawVal = item.resultadoRango !== undefined && item.resultadoRango !== null
      ? item.resultadoRango
      : item.resultadoMensual;
    const tieneResultado = rawVal !== null && rawVal !== undefined && !Number.isNaN(Number(rawVal));

    return {
      ...item,
      posicion: tieneResultado ? contadorPosicion++ : null,
    };
  });
};

export const mapAreasConRanking = mapAreasConRankingCanonico;

const getSemaforoColors = (calif: number | null | undefined): { text: string; bg: string } => {
  if (calif === null || calif === undefined || Number.isNaN(Number(calif))) {
    return { text: '#71717a', bg: '#f4f4f5' };
  }
  const ratio = calif > 1 ? calif / 100 : calif;
  if (ratio >= 0.90) return { text: '#15803d', bg: '#dcfce7' };
  if (ratio >= 0.70) return { text: '#a16207', bg: '#fef9c3' };
  if (ratio >= 0.50) return { text: '#c2410c', bg: '#ffedd5' };
  return { text: '#b91c1c', bg: '#fee2e2' };
};

const formatPct = (val: number | null | undefined): string => {
  if (val === null || val === undefined || Number.isNaN(Number(val))) return '—';
  return `${Number(val).toFixed(1)}%`;
};

function dibujarGaugeSemicircularPdfKit(
  doc: PDFKit.PDFDocument,
  cx: number,
  cy: number,
  r: number,
  score: number | null | undefined,
  strokeColor: string,
) {
  const steps = 36;
  // 1. Arco de fondo gris suave
  doc.lineWidth(3.5).strokeColor('#e4e4e7');
  for (let i = 0; i <= steps; i += 1) {
    const angle = Math.PI - (i / steps) * Math.PI;
    const px = cx + r * Math.cos(angle);
    const py = cy - r * Math.sin(angle);
    if (i === 0) doc.moveTo(px, py);
    else doc.lineTo(px, py);
  }
  doc.stroke();

  // 2. Arco de valor con el color del semáforo
  if (score !== null && score !== undefined && !Number.isNaN(Number(score)) && score >= 0) {
    const ratio = Math.min(Math.max(Number(score), 0), 100) / 100;
    if (ratio > 0) {
      const activeSteps = Math.max(Math.round(steps * ratio), 2);
      doc.lineWidth(4).strokeColor(strokeColor);
      for (let i = 0; i <= activeSteps; i += 1) {
        const angle = Math.PI - (i / activeSteps) * (ratio * Math.PI);
        const px = cx + r * Math.cos(angle);
        const py = cy - r * Math.sin(angle);
        if (i === 0) doc.moveTo(px, py);
        else doc.lineTo(px, py);
      }
      doc.stroke();
    }
  }

  // 3. Texto del score en el centro
  doc.fontSize(11).fillColor('#18181b').font('Helvetica-Bold');
  const scoreTxt = score !== null && score !== undefined && !Number.isNaN(Number(score))
    ? `${Number(score).toFixed(1)}%`
    : '—';
  doc.text(scoreTxt, cx - 35, cy - 10, { width: 70, align: 'center' });

  // 4. Subtítulo
  doc.fontSize(5.5).fillColor('#71717a').font('Helvetica');
  doc.text('RESULTADO GENERAL', cx - 45, cy + 3, { width: 90, align: 'center' });
}

/**
 * Genera el documento PDF de Resultados Generales de 5S en formato Buffer
 * respetando el diseño institucional de Cuadra, la orientación landscape (A4)
 * y el cálculo canónico de posiciones con empates (1, 2, 2, 4).
 */
export const generarPdfResultadosGeneral = async (
  datosGeneral: DatosResultadosGeneral,
  mesEtiqueta: string,
): Promise<Buffer> => {
  return new Promise<Buffer>((resolve, reject) => {
    try {
      // Página A4 horizontal: 841.89 pt ancho x 595.28 pt alto
      const doc = new PDFDocument({
        size: 'A4',
        layout: 'landscape',
        margins: { top: 20, bottom: 0, left: 20, right: 20 },
        info: {
          Title: `Resultados Generales 5S — ${mesEtiqueta}`,
          Author: 'Manufacturera de Botas Cuadra',
          Subject: 'Evaluación Mensual de Auditorías 5S',
        },
      });

      const buffers: Buffer[] = [];
      doc.on('data', (chunk) => buffers.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(buffers)));
      doc.on('error', (err) => reject(err));

      const margin = 20;
      const pageWidth = 841.89;
      const pageHeight = 595.28;

      // 1. Logo de Cuadra
      const logoPath = path.resolve(process.cwd(), 'public/img/01_Cuadra.png');
      if (fs.existsSync(logoPath)) {
        doc.image(logoPath, margin, margin, { width: 110 });
      }

      // 2. Encabezado
      doc.fontSize(14).fillColor('#18181b').font('Helvetica-Bold');
      doc.text('SISTEMA DE AUDITORÍAS 5S', margin + 125, margin + 4);

      doc.fontSize(11).fillColor('#b45309').font('Helvetica-Bold');
      doc.text(`RESULTADOS GENERALES — ${mesEtiqueta.toUpperCase()}`, margin + 125, margin + 20);

      // Línea divisoria
      doc.moveTo(margin, margin + 38).lineTo(pageWidth - margin, margin + 38).strokeColor('#e4e4e7').lineWidth(1).stroke();

      // Layout: 74% Tabla izquierda, 24% Panel derecho
      const contentTop = margin + 46;
      const tableWidth = (pageWidth - margin * 2) * 0.74; // ~593 pt
      const panelX = margin + tableWidth + 14; // ~627 pt
      const panelWidth = pageWidth - margin - panelX; // ~194 pt

      // 3. Panel Lateral Derecho
      // Card 1: Resultados Generales 5S
      let curY = contentTop;
      doc.roundedRect(panelX, curY, panelWidth, 54, 6).fillAndStroke('#fafafa', '#e4e4e7');

      doc.fontSize(8.5).fillColor('#71717a').font('Helvetica-Bold');
      doc.text('RESULTADOS GENERALES 5S', panelX + 12, curY + 11);

      const genPct = datosGeneral.resultadoGeneral;
      const semGen = getSemaforoColors(genPct);

      doc.fontSize(22).fillColor(semGen.text).font('Helvetica-Bold');
      doc.text(formatPct(genPct), panelX + 12, curY + 25);

      // Card 2: Ganadores
      curY += 62;
      const card2Height = 118;
      doc.roundedRect(panelX, curY, panelWidth, card2Height, 6).fillAndStroke('#ffffff', '#e4e4e7');

      doc.fontSize(9.5).fillColor('#18181b').font('Helvetica-Bold');
      doc.text('GANADORES DEL MES', panelX + 12, curY + 10);

      const ganadores = datosGeneral.ganadoresPorTipo;
      let gY = curY + 26;

      // Ganador Administrativo
      doc.fontSize(7.5).fillColor('#71717a').font('Helvetica-Bold');
      doc.text('ADMINISTRATIVO', panelX + 12, gY);
      gY += 11;

      if (ganadores?.administrativo?.areas?.length) {
        for (const area of ganadores.administrativo.areas.slice(0, 2)) {
          doc.fontSize(8.5).fillColor('#18181b').font('Helvetica-Bold');
          doc.text(area.nombre.slice(0, 22), panelX + 12, gY);
          doc.fillColor('#15803d').text(formatPct(ganadores.administrativo.resultado), panelX + panelWidth - 48, gY, { width: 40, align: 'right' });
          gY += 13;
        }
      } else {
        doc.fontSize(8).fillColor('#a1a1aa').font('Helvetica-Oblique');
        doc.text('Sin ganadores elegibles', panelX + 12, gY);
        gY += 13;
      }

      gY += 4;
      // Ganador Operativo
      doc.fontSize(7.5).fillColor('#71717a').font('Helvetica-Bold');
      doc.text('OPERATIVO', panelX + 12, gY);
      gY += 11;

      if (ganadores?.operativo?.areas?.length) {
        for (const area of ganadores.operativo.areas.slice(0, 2)) {
          doc.fontSize(8.5).fillColor('#18181b').font('Helvetica-Bold');
          doc.text(area.nombre.slice(0, 22), panelX + 12, gY);
          doc.fillColor('#15803d').text(formatPct(ganadores.operativo.resultado), panelX + panelWidth - 48, gY, { width: 40, align: 'right' });
          gY += 13;
        }
      } else {
        doc.fontSize(8).fillColor('#a1a1aa').font('Helvetica-Oblique');
        doc.text('Sin ganadores elegibles', panelX + 12, gY);
      }

      // Card 3: Cumplimiento Global (Gráfica Semicircular / Gauge)
      curY += card2Height + 8;
      const card3Height = 88;
      doc.roundedRect(panelX, curY, panelWidth, card3Height, 6).fillAndStroke('#fafafa', '#e4e4e7');

      doc.fontSize(8.5).fillColor('#71717a').font('Helvetica-Bold');
      doc.text('CUMPLIMIENTO GLOBAL', panelX + 12, curY + 10);

      const gaugeCx = panelX + (panelWidth / 2);
      const gaugeCy = curY + 62;
      const gaugeRadius = 28;

      dibujarGaugeSemicircularPdfKit(doc, gaugeCx, gaugeCy, gaugeRadius, genPct, semGen.text);

      // 4. Tabla Principal de Áreas (Izquierda)
      const areasConRanking = mapAreasConRankingCanonico(datosGeneral.areas || []);
      const colRankW = 28;
      const colPeriodoW = 68;
      const colResultadoW = 82;
      const colAreaW = tableWidth - colRankW - (colPeriodoW * 2) - colResultadoW; // ~347 pt

      // Header Tabla
      const thY = contentTop;
      const thHeight = 18;
      doc.rect(margin, thY, tableWidth, thHeight).fill('#f4f4f5');
      doc.rect(margin, thY, tableWidth, thHeight).strokeColor('#e4e4e7').lineWidth(0.75).stroke();

      doc.fontSize(8).fillColor('#52525b').font('Helvetica-Bold');
      doc.text('#', margin + 6, thY + 5, { width: colRankW - 8, align: 'center' });
      doc.text('ÁREA / DEPARTAMENTO', margin + colRankW + 8, thY + 5, { width: colAreaW - 12, align: 'left' });
      doc.text('PERIODO 1', margin + colRankW + colAreaW, thY + 5, { width: colPeriodoW, align: 'center' });
      doc.text('PERIODO 2', margin + colRankW + colAreaW + colPeriodoW, thY + 5, { width: colPeriodoW, align: 'center' });
      doc.text('RESULTADO FINAL', margin + colRankW + colAreaW + colPeriodoW * 2, thY + 5, { width: colResultadoW, align: 'center' });

      // Filas de la Tabla
      let rowY = thY + thHeight;
      const totalAreas = areasConRanking.length;
      // Ajustar altura de fila para que quepan hasta 32 áreas en 1 página
      const rowHeight = totalAreas <= 25 ? 15 : totalAreas <= 32 ? 12.8 : 11;
      const fontSizeFila = totalAreas <= 25 ? 7.5 : totalAreas <= 32 ? 7 : 6.5;

      for (let i = 0; i < areasConRanking.length; i += 1) {
        const item = areasConRanking[i];
        const bgColor = i % 2 === 0 ? '#ffffff' : '#fafafa';
        doc.rect(margin, rowY, tableWidth, rowHeight).fill(bgColor);
        doc.rect(margin, rowY, tableWidth, rowHeight).strokeColor('#f4f4f5').lineWidth(0.5).stroke();

        // Posición
        doc.fontSize(fontSizeFila).fillColor('#71717a').font('Helvetica-Bold');
        const posStr = item.posicion !== null && item.posicion !== undefined ? String(item.posicion) : '';
        doc.text(posStr, margin + 4, rowY + 3, { width: colRankW - 8, align: 'center' });

        // Nombre Área
        doc.fontSize(fontSizeFila).fillColor('#18181b').font('Helvetica-Bold');
        doc.text(item.area.nombre.slice(0, 52), margin + colRankW + 8, rowY + 3, { width: colAreaW - 12, align: 'left' });

        // Periodo 1 y 2
        const p1 = (item.periodos || []).find((p) => p.periodo === 1 || p.numeroCorte === 1);
        const p2 = (item.periodos || []).find((p) => p.periodo === 2 || p.numeroCorte === 2);

        doc.fontSize(fontSizeFila).fillColor('#3f3f46').font('Helvetica');
        doc.text(formatPct(p1?.porcentaje), margin + colRankW + colAreaW, rowY + 3, { width: colPeriodoW, align: 'center' });
        doc.text(formatPct(p2?.porcentaje), margin + colRankW + colAreaW + colPeriodoW, rowY + 3, { width: colPeriodoW, align: 'center' });

        // Resultado Final con color de semáforo suave
        const rawFinal = item.resultadoRango !== undefined && item.resultadoRango !== null
          ? item.resultadoRango
          : item.resultadoMensual;
        const finalVal: number | null = rawFinal !== null && rawFinal !== undefined && !Number.isNaN(Number(rawFinal))
          ? Number(rawFinal)
          : null;
        const semItem = getSemaforoColors(finalVal);

        if (finalVal !== null) {
          doc.rect(margin + colRankW + colAreaW + colPeriodoW * 2 + 10, rowY + 2, colResultadoW - 20, rowHeight - 4).fill(semItem.bg);
          doc.fontSize(fontSizeFila).fillColor(semItem.text).font('Helvetica-Bold');
          doc.text(formatPct(finalVal), margin + colRankW + colAreaW + colPeriodoW * 2, rowY + 3, { width: colResultadoW, align: 'center' });
        } else {
          doc.fontSize(fontSizeFila).fillColor('#a1a1aa').font('Helvetica');
          doc.text('—', margin + colRankW + colAreaW + colPeriodoW * 2, rowY + 3, { width: colResultadoW, align: 'center' });
        }

        rowY += rowHeight;
        if (rowY > pageHeight - 32) break; // Límite inferior de seguridad
      }

      // 5. Footer Institucional
      const footerY = pageHeight - 20;
      doc.moveTo(margin, footerY - 5).lineTo(pageWidth - margin, footerY - 5).strokeColor('#e4e4e7').lineWidth(0.5).stroke();

      doc.fontSize(7).fillColor('#a1a1aa').font('Helvetica');
      doc.text('Manufacturera de Botas Cuadra S.A. de C.V. · Sistema Oficial de Auditorías 5S', margin, footerY, {
        lineBreak: false,
      });

      const fechaEmision = new Date().toLocaleDateString('es-MX', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
      doc.text(`Documento generado el ${fechaEmision}`, pageWidth - margin - 220, footerY, {
        width: 220,
        align: 'right',
        lineBreak: false,
      });

      doc.end();
    } catch (error) {
      reject(error);
    }
  });
};
