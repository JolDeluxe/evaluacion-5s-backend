import { z } from 'zod';
import { TipoArea } from '../../../generated/prisma/enums';

export const esquemaId = z.object({ id: z.coerce.number().int().positive() });

export const esquemaCrearArea = z.object({
  codigo: z.string().trim().min(1).max(50),
  nombre: z.string().trim().min(1).max(160),
  tipo: z.enum(TipoArea),
  responsablesIds: z.array(z.number().int().positive()).default([]),
  inicioProgramaAuditoria: z.enum(['ESTE_MES', 'PROXIMO_MES']).default('PROXIMO_MES'),
  auditorMensualId: z.number().int().positive().optional().nullable(),
});

export const esquemaActualizarArea = esquemaCrearArea.omit({
  responsablesIds: true,
  inicioProgramaAuditoria: true,
  auditorMensualId: true,
}).partial();

export const esquemaActivarArea = z.object({
  inicioProgramaAuditoria: z.enum(['ESTE_MES', 'PROXIMO_MES']).default('PROXIMO_MES'),
  auditorMensualId: z.number().int().positive().optional().nullable(),
});

export const esquemaDesactivarArea = z.object({
  efectivaDesde: z.enum(['ESTE_MES', 'PROXIMO_MES']).default('ESTE_MES'),
});

export const esquemaUsuarioArea = z.object({
  usuarioId: z.number().int().positive(),
});
