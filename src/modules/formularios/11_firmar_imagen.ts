import type { Request, Response } from 'express';
import { cloudinary } from '../../config/cloudinary';
import { env } from '../../config/env';
import { generarUuid } from '../../utils/crypto';
import { servicioNoDisponible } from '../../utils/errores';
import { responder } from '../../utils/respuesta';
import { esquemaFirmarImagenFormulario, esquemaId, esquemaVersionId } from './zod';

const responderFirma = (res: Response, folder: string) => {
  if (!env.CLOUDINARY_ENABLED) throw servicioNoDisponible('Cloudinary no esta habilitado');

  const timestamp = Math.floor(Date.now() / 1000);
  const publicId = `${folder}/${generarUuid()}`;
  const params = {
    folder,
    public_id: publicId,
    timestamp,
  };
  const signature = cloudinary.utils.api_sign_request(params, env.CLOUDINARY_API_SECRET ?? '');

  responder(res, {
    cloudName: env.CLOUDINARY_CLOUD_NAME,
    apiKey: env.CLOUDINARY_API_KEY,
    timestamp,
    signature,
    folder,
    publicId,
  });
};

export const firmarImagenFormulario = async (req: Request, res: Response) => {
  const { versionId } = esquemaVersionId.parse(req.params);
  const body = esquemaFirmarImagenFormulario.parse(req.body);
  const carpetaSeccion = body.seccionClaveEstable ?? 'secciones';
  responderFirma(res, `formularios/versiones/${versionId}/${carpetaSeccion}`);
};

export const firmarImagenFormularioActual = async (req: Request, res: Response) => {
  const { id } = esquemaId.parse(req.params);
  const body = esquemaFirmarImagenFormulario.parse(req.body);
  const carpetaSeccion = body.seccionClaveEstable ?? 'secciones';
  responderFirma(res, `formularios/${id}/${carpetaSeccion}`);
};
