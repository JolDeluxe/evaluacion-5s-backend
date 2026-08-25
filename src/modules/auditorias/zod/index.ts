import { z } from 'zod';

const evidencia = z.object({
  identificadorCliente: z.string().uuid(),
  publicIdCloudinary: z.string().trim().min(1).max(255),
  assetIdCloudinary: z.string().trim().max(255).optional().nullable(),
  formato: z.string().trim().max(20).optional().nullable(),
  tipoMime: z.string().trim().max(120).optional().nullable(),
  bytes: z.number().int().nonnegative().optional().nullable(),
  ancho: z.number().int().positive().optional().nullable(),
  alto: z.number().int().positive().optional().nullable(),
  capturadaEn: z.coerce.date().optional().nullable(),
  subidaEn: z.coerce.date().optional().nullable(),
});

export const esquemaRespuesta = z.object({
  preguntaFormularioId: z.number().int().positive(),
  cumple: z.boolean(),
  hallazgo: z.string().max(20000).optional().nullable(),
  fotos: z.array(evidencia).default([]),
});

export const esquemaEnviarAuditoria = z.object({
  identificadorCliente: z.string().uuid(),
  asignacionAuditoriaId: z.number().int().positive().optional().nullable(),
  nombreAuditorSnapshot: z.string().trim().min(1).max(160),
  finalizadoEn: z.coerce.date(),
  codigoVerificacion: z.string().trim().min(1).max(50),
  respuestas: z.array(esquemaRespuesta).min(1),
});

export const esquemaToken = z.object({ token: z.string().min(32) });
