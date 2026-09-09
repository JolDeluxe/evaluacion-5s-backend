import type { Request, Response } from 'express';
import { prisma } from '../../db';
import { solicitudInvalida } from '../../utils/errores';
import { generarPdfResultadosGeneral } from '../notificaciones/reportes/pdf-resultados';
import { obtenerResultadosGeneral } from './servicio';
import { esquemaResultadosGeneralQuery } from './zod';

export const descargarResultadosGeneralPdf = async (req: Request, res: Response) => {
  const parseResult = esquemaResultadosGeneralQuery.safeParse(req.query);
  if (!parseResult.success) {
    throw solicitudInvalida('Parámetros de consulta para resultados general no válidos');
  }

  // Verifica permisos y obtiene los datos canónicos consolidados
  const datosGeneral = await obtenerResultadosGeneral(prisma, req.autenticacion, parseResult.data);

  const mesClave = ('mes' in datosGeneral && datosGeneral.mes?.clave)
    ? datosGeneral.mes.clave
    : parseResult.data.mes || 'periodo';

  const mesEtiqueta = ('mes' in datosGeneral && datosGeneral.mes?.etiqueta)
    ? datosGeneral.mes.etiqueta
    : ('rango' in datosGeneral && datosGeneral.rango?.etiqueta)
      ? datosGeneral.rango.etiqueta
      : String(mesClave);

  // Genera el documento PDF utilizando la misma función canónica oficial
  const pdfBuffer = await generarPdfResultadosGeneral(datosGeneral, mesEtiqueta);

  const filename = `Resultados Generales 5S - ${mesClave}.pdf`;

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Length', pdfBuffer.length);
  res.end(pdfBuffer);
};
