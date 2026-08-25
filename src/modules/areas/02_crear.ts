import type { Request, Response } from 'express';
import { prisma } from '../../db';
import { responderCreado } from '../../utils/respuesta';
import { registrarAuditoria } from '../registros_auditoria/helper';
import { generarCodigoVerificacionUnico } from './codigo_verificacion';
import { esquemaCrearArea } from './zod';

export const crearArea = async (req: Request, res: Response) => {
  const body = esquemaCrearArea.parse(req.body);
  const area = await prisma.$transaction(async (tx) => {
    const creado = await tx.area.create({
      data: {
        codigo: body.codigo.trim().toUpperCase(),
        nombre: body.nombre.trim(),
        tipo: body.tipo,
        areaPadreId: body.areaPadreId ?? null,
        codigoVerificacion: await generarCodigoVerificacionUnico(tx),
      },
    });
    await registrarAuditoria({ usuarioId: req.autenticacion?.usuarioId, accion: 'CREAR_AREA', tipoEntidad: 'Area', idEntidad: creado.id, datosNuevos: creado }, tx);
    return creado;
  });
  responderCreado(res, { area });
};
