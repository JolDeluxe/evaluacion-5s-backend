import type { Request, Response } from 'express';
import { prisma } from '../../db';
import { generarUuid } from '../../utils/crypto';
import { conflicto } from '../../utils/errores';
import { responderCreado } from '../../utils/respuesta';
import { registrarAuditoria } from '../registros_auditoria/helper';
import { esquemaGuardarEstructuraFormulario, esquemaId } from './zod';

export const guardarEstructuraFormulario = async (req: Request, res: Response) => {
  const { id: formularioId } = esquemaId.parse(req.params);
  const body = esquemaGuardarEstructuraFormulario.parse(req.body);

  const version = await prisma.$transaction(async (tx) => {
    const formulario = await tx.formulario.findUniqueOrThrow({
      where: { id: formularioId },
      include: { versiones: { orderBy: { numeroVersion: 'desc' }, take: 1 } },
    });
    if (!formulario.activo) throw conflicto('No se puede versionar un formulario inactivo');

    await tx.versionFormulario.updateMany({
      where: { formularioId },
      data: { activa: false },
    });

    const creada = await tx.versionFormulario.create({
      data: {
        formularioId,
        numeroVersion: (formulario.versiones[0]?.numeroVersion ?? 0) + 1,
        activa: true,
        creadoPorId: req.autenticacion?.usuarioId ?? formulario.creadoPorId,
        secciones: {
          create: body.secciones.map((seccion) => ({
            claveEstable: seccion.claveEstable ?? generarUuid(),
            nombre: seccion.nombre,
            objetivo: seccion.objetivo ?? null,
            imagenPublicId: seccion.imagenPublicId ?? null,
            imagenAlt: seccion.imagenAlt ?? null,
            orden: seccion.orden,
            preguntas: {
              create: seccion.preguntas.map((pregunta) => ({
                claveEstable: pregunta.claveEstable ?? generarUuid(),
                texto: pregunta.texto,
                orden: pregunta.orden,
              })),
            },
          })),
        },
      },
      include: {
        secciones: {
          include: { preguntas: { orderBy: { orden: 'asc' } } },
          orderBy: { orden: 'asc' },
        },
      },
    });

    await registrarAuditoria({
      usuarioId: req.autenticacion?.usuarioId,
      accion: 'CREAR_VERSION_FORMULARIO',
      tipoEntidad: 'VersionFormulario',
      idEntidad: creada.id,
      datosNuevos: creada,
    }, tx);
    return creada;
  });

  responderCreado(res, { version });
};
