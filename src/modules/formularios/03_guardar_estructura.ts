import type { Request, Response } from 'express';
import { prisma } from '../../db';
import { responder } from '../../utils/respuesta';
import {
  crearRevisionFormularioInterna,
  mapearRevisionFormulario,
} from './helper';
import { esquemaGuardarEstructuraFormulario, esquemaId } from './zod';

export const guardarEstructuraFormulario = async (req: Request, res: Response) => {
  const { id: formularioId } = esquemaId.parse(req.params);
  const body = esquemaGuardarEstructuraFormulario.parse(req.body);

  const resultado = await prisma.$transaction(async (tx) => (
    crearRevisionFormularioInterna(tx, formularioId, body.secciones, req.autenticacion?.usuarioId)
  ));

  responder(res, {
    revision: mapearRevisionFormulario(resultado.revision, true),
    actualizada: resultado.creada,
    tipoCambio: resultado.tipoCambio,
    mensaje: resultado.mensaje,
    aplicadoMesSiguiente: 'aplicadoMesSiguiente' in resultado ? resultado.aplicadoMesSiguiente : false,
  });
};
