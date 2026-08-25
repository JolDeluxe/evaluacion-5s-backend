import { z } from 'zod';
import { TipoArea } from '../../../generated/prisma/enums';

export const esquemaId = z.object({ id: z.coerce.number().int().positive() });

export const esquemaCrearArea = z.object({
  codigo: z.string().trim().min(1).max(50),
  nombre: z.string().trim().min(1).max(160),
  tipo: z.enum(TipoArea),
  areaPadreId: z.number().int().positive().optional().nullable(),
});

export const esquemaActualizarArea = esquemaCrearArea.partial();

export const esquemaUsuarioArea = z.object({
  usuarioId: z.number().int().positive(),
  esResponsable: z.boolean().default(false),
});
