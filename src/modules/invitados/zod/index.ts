import { z } from 'zod';
import { esquemaRespuesta } from '../../auditorias/zod';

export const esquemaIniciarInvitadoPublico = z.object({
  nombre: z.string().trim().min(2).max(160),
  areaId: z.number().int().positive(),
});

export const esquemaContextoInvitado = z.object({
  contextoInvitadoToken: z.string().trim().min(32),
});

export const esquemaEnviarInvitadoPublico = esquemaContextoInvitado.extend({
  identificadorCliente: z.string().uuid(),
  finalizadoEn: z.coerce.date(),
  codigoVerificacion: z.string().trim().min(1).max(50),
  respuestas: z.array(esquemaRespuesta).min(1),
});
