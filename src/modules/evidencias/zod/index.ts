import { z } from 'zod';

export const esquemaFirmar = z.object({
  carpeta: z.string().trim().max(120).default('auditorias-5s'),
  publicId: z.string().trim().max(180).optional(),
});

export const esquemaEnvioId = z.object({ envioId: z.coerce.number().int().positive() });
