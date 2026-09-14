import type { Request, Response } from 'express';
import { responder } from '../../utils/respuesta';
import { sincronizarArchivosCsv } from './servicio_exportacion_csv';

export const sincronizarCsvSistema = async (_req: Request, res: Response) => {
  const resultado = await sincronizarArchivosCsv();
  responder(res, {
    mensaje: 'Archivos CSV sincronizados exitosamente',
    ...resultado,
  });
};
