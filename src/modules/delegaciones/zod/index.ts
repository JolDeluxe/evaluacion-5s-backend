import { z } from 'zod';

const fechaIsoRegex = /^\d{4}-\d{2}-\d{2}$/;

const transformarFechaInicio = (val: string) => {
  const [anio, mes, dia] = val.split('-').map(Number);
  return new Date(Date.UTC(anio, mes - 1, dia, 0, 0, 0, 0));
};

const transformarFechaFin = (val: string) => {
  const [anio, mes, dia] = val.split('-').map(Number);
  return new Date(Date.UTC(anio, mes - 1, dia, 23, 59, 59, 999));
};

export const esquemaCrearDelegacion = z.object({
  ejecutorId: z.coerce.number().int().positive('El id del ejecutor debe ser un entero positivo'),
  responsableId: z.coerce.number().int().positive('El id del responsable debe ser un entero positivo'),
  vigenteDesde: z.string().regex(fechaIsoRegex, 'La fecha de inicio debe tener formato YYYY-MM-DD').transform(transformarFechaInicio),
  vigenteHasta: z.string().regex(fechaIsoRegex, 'La fecha de fin debe tener formato YYYY-MM-DD').transform(transformarFechaFin).nullable().optional(),
  activa: z.boolean().optional().default(true),
});

export const esquemaActualizarDelegacion = z.object({
  vigenteDesde: z.string().regex(fechaIsoRegex, 'La fecha de inicio debe tener formato YYYY-MM-DD').transform(transformarFechaInicio).optional(),
  vigenteHasta: z.string().regex(fechaIsoRegex, 'La fecha de fin debe tener formato YYYY-MM-DD').transform(transformarFechaFin).nullable().optional(),
  activa: z.boolean().optional(),
});

export const esquemaParamIdDelegacion = z.object({
  id: z.coerce.number().int().positive('ID de delegación inválido'),
});

export const esquemaListarDelegaciones = z.object({
  ejecutorId: z.coerce.number().int().positive().optional(),
  responsableId: z.coerce.number().int().positive().optional(),
  activa: z.preprocess((val) => {
    if (val === 'true' || val === true) return true;
    if (val === 'false' || val === false) return false;
    return undefined;
  }, z.boolean().optional()),
});
