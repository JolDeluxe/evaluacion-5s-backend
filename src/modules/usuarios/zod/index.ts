import { z } from 'zod';
import { RolUsuario } from '../../../generated/prisma/enums';

const telefono = z.string().trim().regex(/^\+[1-9]\d{7,14}$/).optional().nullable();

export const esquemaCrearUsuario = z.object({
  nombreUsuario: z.string().trim().min(3).max(80),
  correo: z.string().trim().email().max(180).optional().nullable(),
  telefonoE164: telefono,
  nombre: z.string().trim().min(1).max(160),
  rol: z.enum(RolUsuario),
  contrasena: z.string().min(6).max(128).optional(),
});

const esquemaDecisionAuditoria = z.object({
  clave: z.string().trim().min(1),
  asignacionIds: z.array(z.number().int().positive()).min(1),
  asignacionMensualId: z.number().int().positive().nullable().optional(),
  auditorMensualId: z.number().int().positive().nullable().optional(),
  accion: z.enum(['PENDIENTE', 'REASIGNAR']),
  nuevoAuditorId: z.number().int().positive().nullable().optional(),
});

const esquemaDecisionResponsabilidad = z.object({
  relacionId: z.number().int().positive(),
  areaId: z.number().int().positive(),
  accion: z.enum(['SIN_REEMPLAZO', 'REEMPLAZAR']),
  nuevoResponsableId: z.number().int().positive().nullable().optional(),
});

export const esquemaResolucionesAuditoriaUsuario = z.object({
  usuarioActualizadoEn: z.coerce.date(),
  auditorias: z.array(esquemaDecisionAuditoria),
});

export const esquemaResolverBajaUsuario = esquemaResolucionesAuditoriaUsuario.extend({
  responsabilidades: z.array(esquemaDecisionResponsabilidad),
});

export const esquemaActualizarUsuario = esquemaCrearUsuario.partial().omit({ contrasena: true }).extend({
  resolucionesAuditorias: esquemaResolucionesAuditoriaUsuario.optional(),
});

export const esquemaId = z.object({ id: z.coerce.number().int().positive() });

export const esquemaContrasenaTemporal = z.object({
  contrasena: z.string().min(6).max(128),
  debeCambiarContrasena: z.boolean().default(true),
});
