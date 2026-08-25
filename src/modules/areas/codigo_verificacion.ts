import { randomInt } from 'node:crypto';
import { prisma, type PrismaTransaction } from '../../db';

const alfabeto = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

const segmento = () => Array.from({ length: 4 }, () => alfabeto[randomInt(alfabeto.length)]).join('');

export const generarCodigoVerificacion = () => `${segmento()}-${segmento()}`;

export const generarCodigoVerificacionUnico = async (tx: PrismaTransaction | typeof prisma = prisma) => {
  for (let intento = 0; intento < 12; intento += 1) {
    const codigo = generarCodigoVerificacion();
    const existente = await tx.area.findUnique({ where: { codigoVerificacion: codigo }, select: { id: true } });
    if (!existente) return codigo;
  }

  throw new Error('No fue posible generar un codigo de verificacion unico');
};
