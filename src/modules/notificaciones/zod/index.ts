import { z } from 'zod';

export const esquemaSuscripcionPush = z.object({
  endpoint: z.string().url(),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
  nombreDispositivo: z.string().trim().max(120).optional(),
});

export const esquemaId = z.object({ id: z.coerce.number().int().positive() });
