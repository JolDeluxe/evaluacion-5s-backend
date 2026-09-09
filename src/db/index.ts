import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { PrismaClient } from '../generated/prisma/client';
import { env } from '../config/env';

const rawUrl =
  env.NODE_ENV === 'test'
    ? process.env.DATABASE_URL_TEST || env.DATABASE_URL_TEST || env.DATABASE_URL
    : env.DATABASE_URL;

const databaseUrl = new URL(rawUrl);
const dbName = databaseUrl.pathname.replace(/^\//, '');

// GUARD DE SEGURIDAD ESTRICTO:
// Si se ejecutan tests (NODE_ENV === 'test'), NUNCA permitir conectarse a la base de datos de producción o desarrollo.
if (env.NODE_ENV === 'test') {
  const nombreLimpio = dbName.toLowerCase();
  const esBasePeligrosa =
    nombreLimpio === 'encuestas_5s' ||
    (!nombreLimpio.endsWith('_test') && !nombreLimpio.includes('test'));

  if (esBasePeligrosa) {
    const errorCritico = `[GUARD DE SEGURIDAD CRÍTICO] Se intentó ejecutar pruebas conectándose a la base de datos no aislada "${dbName}". Las pruebas deben ejecutarse exclusivamente contra una base de datos de test dedicada (ej. encuestas_5s_test). Abortando proceso para proteger datos reales.`;
    console.error(errorCritico);
    throw new Error(errorCritico);
  }
}

const adapter = new PrismaMariaDb({
  host: databaseUrl.hostname,
  port: databaseUrl.port ? Number(databaseUrl.port) : 3306,
  user: decodeURIComponent(databaseUrl.username),
  password: decodeURIComponent(databaseUrl.password),
  database: dbName,
  connectionLimit: 5,
  allowPublicKeyRetrieval: true,
});

export const prisma = new PrismaClient({
  adapter,
});

export type PrismaTransaction = Omit<
  typeof prisma,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

export const cerrarPrisma = () => prisma.$disconnect();
