import { z } from 'zod';
import { TipoArea } from '../../../generated/prisma/enums';

export const esquemaFiltros = z.object({
  anio: z.coerce.number().int().optional(),
  mes: z.coerce.number().int().min(1).max(12).optional(),
  numeroCorte: z.coerce.number().int().min(1).max(2).optional(),
  tipoArea: z.enum(TipoArea).optional(),
});

export const esquemaArea = z.object({ id: z.coerce.number().int().positive() });
