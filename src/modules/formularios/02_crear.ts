import type { Request, Response } from 'express';
import { prisma } from '../../db';
import { responderCreado } from '../../utils/respuesta';
import { registrarAuditoria } from '../registros_auditoria/helper';
import { esquemaCrearFormulario } from './zod';

export const crearFormulario = async (req: Request, res: Response) => {
  const body = esquemaCrearFormulario.parse(req.body);
  const formulario = await prisma.$transaction(async (tx) => {
    const creado = await tx.formulario.create({
      data: {
        nombre: body.nombre.trim(),
        slug: body.slug.trim(),
        descripcion: body.descripcion?.trim() || null,
        alcance: body.alcance,
        creadoPorId: req.autenticacion?.usuarioId ?? 1,
      },
    });
    await registrarAuditoria({ usuarioId: req.autenticacion?.usuarioId, accion: 'CREAR_FORMULARIO', tipoEntidad: 'Formulario', idEntidad: creado.id, datosNuevos: creado }, tx);
    return creado;
  });
  responderCreado(res, { formulario });
};
