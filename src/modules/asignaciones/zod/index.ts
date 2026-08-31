import { z } from 'zod';

export const esquemaId = z.object({ id: z.coerce.number().int().positive() });
export const esquemaAreaId = z.object({ areaId: z.coerce.number().int().positive() });

export const esquemaMes = z.object({
  anio: z.coerce.number().int().min(2020).max(2100),
  mes: z.coerce.number().int().min(1).max(12),
});

export const esquemaQueryMensual = esquemaMes.extend({
  busqueda: z.string().trim().optional(),
  estado: z.enum(['ASIGNADO', 'SIN_AUDITOR']).optional(),
  auditorId: z.coerce.number().int().positive().optional(),
}).passthrough();

export const esquemaGuardarAsignacionMensual = esquemaMes.extend({
  auditorMensualId: z.number().int().positive(),
});

export const esquemaAutoasignarMensual = esquemaMes;

export const esquemaReabrirAsignacion = z.object({
  motivo: z.string().trim().min(1).max(2000),
  reabiertaHasta: z.coerce.date().optional(),
});

export const esquemaCrearAsignacion = z.object({
  objetivoAuditoriaId: z.number().int().positive(),
  auditorId: z.number().int().positive(),
  venceEn: z.coerce.date(),
});

export const esquemaReasignar = z.object({
  auditorId: z.number().int().positive(),
  venceEn: z.coerce.date().optional(),
  motivoCancelacion: z.string().trim().max(2000).optional(),
});

export const esquemaCrearEnlace = z.object({
  expiraEn: z.coerce.date().optional(),
});
