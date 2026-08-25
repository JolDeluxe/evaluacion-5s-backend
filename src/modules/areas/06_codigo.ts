import QRCode from 'qrcode';
import type { Request, Response } from 'express';
import { prisma } from '../../db';
import { responder } from '../../utils/respuesta';
import { registrarAuditoria } from '../registros_auditoria/helper';
import { generarCodigoVerificacionUnico } from './codigo_verificacion';
import { esquemaId } from './zod';

export const obtenerCodigoArea = async (req: Request, res: Response) => {
  const { id } = esquemaId.parse(req.params);
  const area = await prisma.area.findUniqueOrThrow({
    where: { id },
    select: { id: true, codigo: true, nombre: true, codigoVerificacion: true },
  });
  responder(res, { area });
};

export const imagenCodigoArea = async (req: Request, res: Response) => {
  const { id } = esquemaId.parse(req.params);
  const area = await prisma.area.findUniqueOrThrow({
    where: { id },
    select: { codigoVerificacion: true },
  });
  const svg = await QRCode.toString(area.codigoVerificacion, {
    type: 'svg',
    errorCorrectionLevel: 'M',
    margin: 2,
  });
  res.type('image/svg+xml').send(svg);
};

export const rotarCodigoArea = async (req: Request, res: Response) => {
  const { id } = esquemaId.parse(req.params);
  const area = await prisma.$transaction(async (tx) => {
    const anterior = await tx.area.findUniqueOrThrow({ where: { id } });
    const actualizado = await tx.area.update({
      where: { id },
      data: { codigoVerificacion: await generarCodigoVerificacionUnico(tx) },
    });
    await registrarAuditoria({
      usuarioId: req.autenticacion?.usuarioId,
      accion: 'ROTAR_CODIGO_VERIFICACION_AREA',
      tipoEntidad: 'Area',
      idEntidad: id,
      datosAnteriores: { codigoVerificacion: anterior.codigoVerificacion },
      datosNuevos: { codigoVerificacion: actualizado.codigoVerificacion },
    }, tx);
    return actualizado;
  });
  responder(res, { area });
};
