import { z } from 'zod';

export const esquemaPaginacion = z.object({
  pagina: z.coerce.number().int().positive().optional(),
  page: z.coerce.number().int().positive().optional(),
  limite: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().optional(),
  cursor: z.coerce.number().int().positive().optional(),
});

export const obtenerPaginacion = (query: unknown) => {
  const parsed = esquemaPaginacion.parse(query);
  const pagina = parsed.pagina ?? parsed.page ?? 1;
  const limite = parsed.limite ?? parsed.limit ?? 25;
  return {
    pagina,
    limite,
    saltar: (pagina - 1) * limite,
  };
};
