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

export const esquemaActualizarUsuario = esquemaCrearUsuario.partial().omit({ contrasena: true });

export const esquemaId = z.object({ id: z.coerce.number().int().positive() });

export const esquemaContrasenaTemporal = z.object({
  contrasena: z.string().min(6).max(128),
  debeCambiarContrasena: z.boolean().default(true),
});
