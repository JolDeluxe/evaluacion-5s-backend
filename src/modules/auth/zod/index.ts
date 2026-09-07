import { z } from 'zod';

export const esquemaIniciarSesion = z.object({
  nombreUsuario: z.string().trim().min(1).max(180),
  contrasena: z.string().min(1).max(128),
});

export const esquemaSolicitarRestablecimiento = z.object({
  correo: z.string().trim().email().max(180),
});

export const esquemaRestablecerContrasena = z.object({
  token: z.string().min(32),
  contrasena: z.string().min(6).max(128),
});

export const esquemaCambiarContrasena = z.object({
  contrasenaActual: z.string().min(1).max(128),
  contrasenaNueva: z.string().min(6).max(128),
});

export const esquemaActualizarPerfil = z.object({
  nombre: z.string().trim().min(2, 'El nombre debe tener al menos 2 caracteres').max(160, 'El nombre no debe exceder 160 caracteres'),
  correo: z.string().trim().email('Formato de correo inválido').max(180, 'El correo no debe exceder 180 caracteres').optional().nullable().or(z.literal('')),
  telefonoE164: z.string().trim().max(24, 'El teléfono no debe exceder 24 caracteres').optional().nullable().or(z.literal('')),
});

