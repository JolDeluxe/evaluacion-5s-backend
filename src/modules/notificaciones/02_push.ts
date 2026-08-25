import type { Request, Response } from 'express';
import { prisma } from '../../db';
import { hashSha256 } from '../../utils/crypto';
import { noAutenticado } from '../../utils/errores';
import { responder } from '../../utils/respuesta';
import { esquemaSuscripcionPush } from './zod';

export const registrarSuscripcionPush = async (req: Request, res: Response) => {
  if (!req.autenticacion) throw noAutenticado();
  const body = esquemaSuscripcionPush.parse(req.body);
  const hashEndpoint = hashSha256(body.endpoint);
  const suscripcion = await prisma.suscripcionPush.upsert({
    where: { hashEndpoint },
    update: {
      usuarioId: req.autenticacion.usuarioId,
      endpoint: body.endpoint,
      p256dh: body.keys.p256dh,
      auth: body.keys.auth,
      nombreDispositivo: body.nombreDispositivo,
      agenteUsuario: req.get('user-agent') ?? null,
      ultimoUsoEn: new Date(),
      revocadoEn: null,
    },
    create: {
      usuarioId: req.autenticacion.usuarioId,
      endpoint: body.endpoint,
      hashEndpoint,
      p256dh: body.keys.p256dh,
      auth: body.keys.auth,
      nombreDispositivo: body.nombreDispositivo,
      agenteUsuario: req.get('user-agent') ?? null,
      ultimoUsoEn: new Date(),
    },
  });
  responder(res, { suscripcion });
};
