import { z } from 'zod';

export const esquemaQueryCumplimientos = z.object({
  anio: z.coerce.number().int().min(2020).max(2100).optional(),
  mes: z.coerce.number().int().min(1).max(12).optional(),
});

export const esquemaParamUsuarioId = z.object({
  id: z.coerce.number().int().positive('ID de usuario inválido'),
});

export const esquemaRecalcular = z.object({
  anio: z.coerce.number().int().min(2020).max(2100),
  mes: z.coerce.number().int().min(1).max(12),
});
