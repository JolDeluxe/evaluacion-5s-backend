import type { Request, Response } from 'express';
import { cloudinary } from '../../config/cloudinary';
import { env } from '../../config/env';
import { generarUuid } from '../../utils/crypto';
import { servicioNoDisponible } from '../../utils/errores';
import { responder } from '../../utils/respuesta';
import { esquemaFirmarImagenFormulario, esquemaVersionId } from './zod';

export const firmarImagenFormulario = async (req: Request, res: Response) => {
  if (!env.CLOUDINARY_ENABLED) throw servicioNoDisponible('Cloudinary no esta habilitado');

  const { versionId } = esquemaVersionId.parse(req.params);
  const body = esquemaFirmarImagenFormulario.parse(req.body);

  const timestamp = Math.round(Date.now() / 1000);
  const folder = `formularios/versiones/${versionId}`;
  const publicId = `${folder}/${body.seccionClaveEstable ?? generarUuid()}`;
  const params = {
    timestamp,
    public_id: publicId,
    folder,
  };

  const signature = cloudinary.utils.api_sign_request(params, env.CLOUDINARY_API_SECRET ?? '');
  responder(res, {
    cloudName: env.CLOUDINARY_CLOUD_NAME,
    apiKey: env.CLOUDINARY_API_KEY,
    timestamp,
    publicId,
    folder,
    signature,
  });
};
