import type { Request, Response } from 'express';
import { cloudinary } from '../../config/cloudinary';
import { env } from '../../config/env';
import { servicioNoDisponible } from '../../utils/errores';
import { responder } from '../../utils/respuesta';
import { generarUuid } from '../../utils/crypto';
import { esquemaFirmar } from './zod';

export const firmarEvidencia = async (req: Request, res: Response) => {
  if (!env.CLOUDINARY_ENABLED) throw servicioNoDisponible('Cloudinary no esta habilitado');
  const body = esquemaFirmar.parse(req.body);
  const timestamp = Math.round(Date.now() / 1000);
  const publicId = body.publicId ?? `${body.carpeta}/${generarUuid()}`;
  const params = {
    timestamp,
    public_id: publicId,
    folder: body.carpeta,
  };
  const signature = cloudinary.utils.api_sign_request(params, env.CLOUDINARY_API_SECRET ?? '');
  responder(res, {
    cloudName: env.CLOUDINARY_CLOUD_NAME,
    apiKey: env.CLOUDINARY_API_KEY,
    timestamp,
    publicId,
    folder: body.carpeta,
    signature,
  });
};
