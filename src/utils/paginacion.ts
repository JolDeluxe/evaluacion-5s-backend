import { z } from 'zod';

export const esquemaPaginacion = z.object({
  pagina: z.coerce.number().int().positive().default(1),
  limite: z.coerce.number().int().positive().max(100).default(25),
});

export const obtenerPaginacion = (query: unknown) => {
  const { pagina, limite } = esquemaPaginacion.parse(query);
  return {
    pagina,
    limite,
    saltar: (pagina - 1) * limite,
  };
};
