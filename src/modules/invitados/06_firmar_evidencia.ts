import type { Request, Response } from 'express';
import { cloudinary } from '../../config/cloudinary';
import { env } from '../../config/env';
import { prisma } from '../../db';
import { hashSha256, generarUuid } from '../../utils/crypto';
import { noEncontrado, servicioNoDisponible } from '../../utils/errores';
import { validarObjetivoRealizableMasAntiguo } from '../../utils/objetivos_periodo';
import { responder } from '../../utils/respuesta';
import { esquemaToken } from '../auditorias/zod';
import { esquemaFirmar } from '../evidencias/zod';

export const firmarEvidenciaInvitado = async (req: Request, res: Response) => {
  if (!env.CLOUDINARY_ENABLED) throw servicioNoDisponible('Cloudinary no esta habilitado');

  const { token } = esquemaToken.parse(req.params);
  const enlace = await prisma.enlaceInvitado.findUnique({
    where: { hashToken: hashSha256(token) },
    include: { asignacionAuditoria: { select: { objetivoAuditoriaId: true } } },
  });
  if (!enlace || enlace.revocadoEn || enlace.expiraEn <= new Date()) throw noEncontrado('Enlace no valido');
  await validarObjetivoRealizableMasAntiguo(prisma, enlace.asignacionAuditoria.objetivoAuditoriaId);

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
