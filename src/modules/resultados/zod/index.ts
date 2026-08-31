import { z } from 'zod';
import { TipoArea } from '../../../generated/prisma/enums';

export const esquemaFiltros = z.object({
  anio: z.coerce.number().int().optional(),
  mes: z.coerce.number().int().min(1).max(12).optional(),
  numeroCorte: z.coerce.number().int().min(1).max(2).optional(),
  tipoArea: z.enum(TipoArea).optional(),
});

export const esquemaResultadosGeneralQuery = z.object({
  tipo: z.enum(['mes', 'trimestre', 'semestre', 'anio']).optional(),
  mes: z.string().optional(),
  anio: z.coerce.number().int().min(2020).max(2100).optional(),
  trimestre: z.coerce.number().int().min(1).max(4).optional(),
  semestre: z.coerce.number().int().min(1).max(2).optional(),
  tipoArea: z.enum(TipoArea).optional(),
});

export const esquemaArea = z.object({ id: z.coerce.number().int().positive() });

export const esquemaAreaResultados = z.object({
  areaId: z.coerce.number().int().positive(),
});

export const esquemaPeriodoResultados = z.object({
  areaId: z.coerce.number().int().positive(),
  periodo: z.coerce.number().int().min(1).max(2),
});
