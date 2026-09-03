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
  expectedAuditorId: z.number().int().positive().nullable().optional(),
});

export const esquemaAutoasignarMensual = esquemaMes;

export const esquemaConfirmarAutoasignacion = esquemaMes.extend({
  asignaciones: z.array(z.object({
    areaId: z.number().int().positive(),
    auditorId: z.number().int().positive(),
  })).min(1),
}).superRefine((body, context) => {
  const areas = new Set<number>();
  for (const [index, asignacion] of body.asignaciones.entries()) {
    if (areas.has(asignacion.areaId)) {
      context.addIssue({
        code: 'custom',
        path: ['asignaciones', index, 'areaId'],
        message: 'Cada area solo puede confirmarse una vez',
      });
    }
    areas.add(asignacion.areaId);
  }
});

export const esquemaReabrirAsignacion = z.object({
  motivo: z.string().trim().min(1).max(2000),
  reabiertaHasta: z.coerce.date().optional(),
  auditorMensualId: z.coerce.number().int().positive().optional(),
  expectedAuditorId: z.number().int().positive().nullable().optional(),
  objetivoAuditoriaId: z.coerce.number().int().positive().optional(),
});

export const esquemaCrearEnlace = z.object({
  expiraEn: z.coerce.date().optional(),
});
