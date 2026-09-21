import { Prisma } from '../generated/prisma/client';
import { prisma, type PrismaTransaction } from '../db';

export const esConflictoTransaccion = (error: unknown): boolean => {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2034') return true;
    if (error.code === 'P2010') {
      const metaStr = JSON.stringify(error.meta ?? {}).toLowerCase();
      if (metaStr.includes('1213') || metaStr.includes('deadlock') || metaStr.includes('transactionwriteconflict')) {
        return true;
      }
    }
  }
  if (error instanceof Error) {
    const mensaje = error.message.toLowerCase();
    if (mensaje.includes('1213') || mensaje.includes('deadlock found')) {
      return true;
    }
  }
  return false;
};

export const transaccionSerializable = async <T>(
  operacion: (tx: PrismaTransaction) => Promise<T>
) => {
  let ultimoError: unknown;

  for (let intento = 1; intento <= 4; intento += 1) {
    try {
      return await prisma.$transaction(
        async (tx) => operacion(tx as PrismaTransaction),
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
      );
    } catch (error) {
      ultimoError = error;
      if (!esConflictoTransaccion(error) || intento === 4) throw error;
      const esperaConJitter = (20 * intento) + Math.floor(Math.random() * 25);
      await Bun.sleep(esperaConJitter);
    }
  }

  throw ultimoError;
};
