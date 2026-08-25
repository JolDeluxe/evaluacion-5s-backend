import type { Prisma } from '../../generated/prisma/client';
import { prisma, type PrismaTransaction } from '../../db';

const camposSensibles = new Set([
  'hashContrasena',
  'hashToken',
  'token',
  'contrasena',
  'password',
  'SMTP_PASS',
  'CLOUDINARY_API_SECRET',
  'VAPID_PRIVATE_KEY',
]);

export const sanitizarAuditoria = (valor: unknown): Prisma.InputJsonValue | undefined => {
  if (valor === undefined || valor === null) return undefined;
  if (Array.isArray(valor)) return valor.map((item) => sanitizarAuditoria(item) ?? null);
  if (typeof valor === 'object') {
    const limpio: Record<string, Prisma.InputJsonValue | null> = {};
    for (const [clave, contenido] of Object.entries(valor)) {
      if (camposSensibles.has(clave)) continue;
      limpio[clave] = sanitizarAuditoria(contenido) ?? null;
    }
    return limpio;
  }
  if (typeof valor === 'string' || typeof valor === 'number' || typeof valor === 'boolean') return valor;
  return String(valor);
};

export const registrarAuditoria = async (
  data: {
    usuarioId?: number | null;
    accion: string;
    tipoEntidad: string;
    idEntidad?: number | null;
    datosAnteriores?: unknown;
    datosNuevos?: unknown;
    direccionIp?: string | null;
    agenteUsuario?: string | null;
  },
  tx: PrismaTransaction | typeof prisma = prisma
) => tx.registroAuditoria.create({
  data: {
    usuarioId: data.usuarioId ?? null,
    accion: data.accion,
    tipoEntidad: data.tipoEntidad,
    idEntidad: data.idEntidad ?? null,
    datosAnteriores: sanitizarAuditoria(data.datosAnteriores),
    datosNuevos: sanitizarAuditoria(data.datosNuevos),
    direccionIp: data.direccionIp ?? null,
    agenteUsuario: data.agenteUsuario ?? null,
  },
});
