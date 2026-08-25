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
