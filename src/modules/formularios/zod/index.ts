import { z } from 'zod';
import { AlcanceFormulario } from '../../../generated/prisma/enums';

export const esquemaId = z.object({ id: z.coerce.number().int().positive() });
export const esquemaVersionId = z.object({ versionId: z.coerce.number().int().positive() });

export const esquemaCrearFormulario = z.object({
  nombre: z.string().trim().min(1).max(160),
  slug: z.string().trim().min(1).max(120).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  descripcion: z.string().trim().max(5000).optional().nullable(),
  alcance: z.enum(AlcanceFormulario),
});

export const esquemaActualizarFormulario = z.object({
  nombre: z.string().trim().min(1).max(160).optional(),
  descripcion: z.string().trim().max(5000).optional().nullable(),
  alcance: z.enum(AlcanceFormulario).optional(),
  activo: z.boolean().optional(),
});

export const esquemaCrearVersion = z.object({
  desdeVersionId: z.number().int().positive().optional(),
});

export const esquemaPreguntaFormulario = z.object({
  claveEstable: z.string().uuid().optional(),
  texto: z.string().trim().min(1).max(5000),
  orden: z.number().int().nonnegative(),
});

export const esquemaSeccionFormulario = z.object({
  claveEstable: z.string().uuid().optional(),
  nombre: z.string().trim().min(1).max(160),
  objetivo: z.string().trim().max(5000).optional().nullable(),
  imagenPublicId: z.string().trim().min(1).max(255).optional().nullable(),
  imagenAlt: z.string().trim().min(1).max(255).optional().nullable(),
  orden: z.number().int().nonnegative(),
  preguntas: z.array(esquemaPreguntaFormulario).min(1),
}).superRefine((seccion, ctx) => {
  if ((seccion.imagenPublicId && !seccion.imagenAlt) || (!seccion.imagenPublicId && seccion.imagenAlt)) {
    ctx.addIssue({
      code: 'custom',
      path: ['imagenAlt'],
      message: 'imagenPublicId e imagenAlt deben definirse juntos',
    });
  }
});

export const esquemaGuardarEstructuraFormulario = z.object({
  secciones: z.array(esquemaSeccionFormulario).min(1),
});

export const esquemaFirmarImagenFormulario = z.object({
  seccionClaveEstable: z.string().uuid().optional(),
});
