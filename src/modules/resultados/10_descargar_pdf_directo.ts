import type { Request, Response } from 'express';
import { prisma } from '../../db';
import { RolUsuario } from '../../generated/prisma/enums';
import { generarPdfResultadosGeneral } from '../notificaciones/reportes/pdf-resultados';
import { obtenerResultadosGeneral } from './servicio';
import { verificarTokenDescargaPdf } from './token_descarga_pdf';

export const descargarResultadosGeneralPdfDirecto = async (req: Request, res: Response) => {
  const token = typeof req.query.token === 'string' ? req.query.token : null;

  if (!token) {
    res.status(400).send(`
      <!DOCTYPE html>
      <html lang="es">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Descarga no disponible — Encuestas 5S</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #f4f4f5; color: #18181b; }
          .card { background: #ffffff; border: 1px solid #e4e4e7; border-radius: 12px; padding: 32px; max-width: 440px; text-align: center; box-shadow: 0 4px 12px rgba(0,0,0,0.06); }
          h2 { margin-top: 0; color: #b91c1c; font-size: 18px; }
          p { color: #52525b; font-size: 14px; line-height: 1.5; margin: 12px 0; }
        </style>
      </head>
      <body>
        <div class="card">
          <h2>Enlace de descarga no disponible</h2>
          <p>No se especificó un token de descarga válido.</p>
          <p>Por favor utiliza el enlace enviado a tu correo institucional o consulta el archivo adjunto en tu mensaje.</p>
        </div>
      </body>
      </html>
    `);
    return;
  }

  try {
    // 1. Verifica la firma criptográfica y la vigencia del token
    const payload = verificarTokenDescargaPdf(token);

    // 2. Consulta los datos canónicos como proceso de sistema
    const authInterna = { usuarioId: payload.usuarioId ?? 0, rol: RolUsuario.SUPER_ADMIN };
    const datosGeneral = await obtenerResultadosGeneral(prisma, authInterna, {
      tipo: 'mes',
      mes: payload.mes,
    });

    const mesClave = payload.mes;
    const mesEtiqueta = ('mes' in datosGeneral && datosGeneral.mes?.etiqueta)
      ? datosGeneral.mes.etiqueta
      : ('rango' in datosGeneral && datosGeneral.rango?.etiqueta)
        ? datosGeneral.rango.etiqueta
        : mesClave;

    // 3. Genera el PDF canónico de 1 sola página
    const pdfBuffer = await generarPdfResultadosGeneral(datosGeneral, mesEtiqueta);

    const filename = `Resultados Generales 5S - ${mesClave}.pdf`;

    // 4. Envía como descarga forzada directa (attachment)
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', pdfBuffer.length);
    res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
    res.end(pdfBuffer);
  } catch (error) {
    const mensaje = error instanceof Error ? error.message : 'El enlace no es válido o ya ha expirado.';
    res.status(403).send(`
      <!DOCTYPE html>
      <html lang="es">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Enlace no disponible — Encuestas 5S</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #f4f4f5; color: #18181b; }
          .card { background: #ffffff; border: 1px solid #e4e4e7; border-radius: 12px; padding: 32px; max-width: 440px; text-align: center; box-shadow: 0 4px 12px rgba(0,0,0,0.06); }
          h2 { margin-top: 0; color: #b91c1c; font-size: 18px; }
          p { color: #52525b; font-size: 14px; line-height: 1.5; margin: 12px 0; }
        </style>
      </head>
      <body>
        <div class="card">
          <h2>Enlace de descarga no disponible</h2>
          <p>${mensaje}</p>
          <p>Para consultar el reporte oficial, inicia sesión en la plataforma o abre el archivo PDF adjunto en tu correo.</p>
        </div>
      </body>
      </html>
    `);
  }
};
