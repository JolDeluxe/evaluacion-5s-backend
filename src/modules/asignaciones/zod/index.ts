import { z } from 'zod';

export const esquemaId = z.object({ id: z.coerce.number().int().positive() });

export const esquemaCrearAsignacion = z.object({
  objetivoAuditoriaId: z.number().int().positive(),
  auditorId: z.number().int().positive(),
  venceEn: z.coerce.date(),
});

export const esquemaReasignar = z.object({
  auditorId: z.number().int().positive(),
  venceEn: z.coerce.date().optional(),
  motivoCancelacion: z.string().trim().max(2000).optional(),
});

export const esquemaCrearEnlace = z.object({
  expiraEn: z.coerce.date(),
});
