import { Prisma } from '../generated/prisma/client';
import { prisma, type PrismaTransaction } from '../db';

const esConflictoTransaccion = (error: unknown) => (
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034'
);

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
      await Bun.sleep(25 * intento);
    }
  }

  throw ultimoError;
};
