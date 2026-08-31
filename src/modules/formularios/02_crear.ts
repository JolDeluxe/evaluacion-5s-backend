import type { Request, Response } from 'express';
import { prisma } from '../../db';
import { responderCreado } from '../../utils/respuesta';
import { registrarAuditoria } from '../registros_auditoria/helper';
import { esquemaCrearFormulario } from './zod';

const crearSlugBase = (nombre: string) => (
  nombre
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100)
    || 'formulario'
);

export const crearFormulario = async (req: Request, res: Response) => {
  const body = esquemaCrearFormulario.parse(req.body);
  const formulario = await prisma.$transaction(async (tx) => {
    const slugBase = body.slug ?? crearSlugBase(body.nombre);
    const existentes = await tx.formulario.count({
      where: {
        OR: [
          { slug: slugBase },
          { slug: { startsWith: `${slugBase}-` } },
        ],
      },
    });
    const slug = existentes ? `${slugBase}-${existentes + 1}` : slugBase;

    const creado = await tx.formulario.create({
      data: {
        nombre: body.nombre.trim(),
        slug,
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
