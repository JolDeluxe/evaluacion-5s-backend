import { z } from 'zod';
import { TipoArea } from '../../../generated/prisma/enums';

export const esquemaId = z.object({ id: z.coerce.number().int().positive() });

export const esquemaCrearCiclo = z.object({
  anio: z.number().int().min(2020).max(2100),
  mes: z.number().int().min(1).max(12),
  numeroCorte: z.number().int().min(1).max(2),
  nombre: z.string().trim().max(160).optional().nullable(),
  iniciaEn: z.coerce.date(),
  terminaEn: z.coerce.date(),
  formularios: z.array(z.object({
    tipoArea: z.enum(TipoArea),
    versionFormularioId: z.number().int().positive(),
  })).min(1),
});
