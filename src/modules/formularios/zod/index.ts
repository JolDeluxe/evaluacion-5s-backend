import { z } from 'zod';
import { AlcanceFormulario } from '../../../generated/prisma/enums';

export const esquemaId = z.object({ id: z.coerce.number().int().positive() });
export const esquemaVersionId = z.object({ versionId: z.coerce.number().int().positive() });

export const esquemaCrearFormulario = z.object({
  nombre: z.string().trim().min(1).max(160),
  slug: z.string().trim().min(1).max(120).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).optional(),
  descripcion: z.string().trim().max(5000).optional().nullable(),
  alcance: z.enum(AlcanceFormulario),
});

export const esquemaActualizarFormulario = z.object({
  nombre: z.string().trim().min(1).max(160).optional(),
  descripcion: z.string().trim().max(5000).optional().nullable(),
  alcance: z.enum(AlcanceFormulario).optional(),
  activo: z.boolean().optional(),
});

export const esquemaPreguntaFormulario = z.object({
  claveEstable: z.string().uuid().optional(),
  texto: z.string().trim().min(1).max(5000),
  orden: z.number().int().nonnegative(),
  requiereHallazgo: z.boolean().default(true),
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
}).superRefine((estructura, ctx) => {
  const ordenesSeccion = new Set<number>();
  estructura.secciones.forEach((seccion, seccionIndex) => {
    if (ordenesSeccion.has(seccion.orden)) {
      ctx.addIssue({
        code: 'custom',
        path: ['secciones', seccionIndex, 'orden'],
        message: 'No puede haber secciones con el mismo orden',
      });
    }
    ordenesSeccion.add(seccion.orden);

    const ordenesPregunta = new Set<number>();
    seccion.preguntas.forEach((pregunta, preguntaIndex) => {
      if (ordenesPregunta.has(pregunta.orden)) {
        ctx.addIssue({
          code: 'custom',
          path: ['secciones', seccionIndex, 'preguntas', preguntaIndex, 'orden'],
          message: 'No puede haber preguntas con el mismo orden dentro de una seccion',
        });
      }
      ordenesPregunta.add(pregunta.orden);
    });
  });
});

export type EstructuraFormularioEntrada = z.infer<typeof esquemaGuardarEstructuraFormulario>;

export const esquemaFirmarImagenFormulario = z.object({
  seccionClaveEstable: z.string().uuid().optional(),
});
