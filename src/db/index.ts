import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { PrismaClient } from '../generated/prisma/client';
import { env } from '../config/env';

const databaseUrl = new URL(env.DATABASE_URL);
const adapter = new PrismaMariaDb({
  host: databaseUrl.hostname,
  port: databaseUrl.port ? Number(databaseUrl.port) : 3306,
  user: decodeURIComponent(databaseUrl.username),
  password: decodeURIComponent(databaseUrl.password),
  database: databaseUrl.pathname.replace(/^\//, ''),
  connectionLimit: 5,
});

export const prisma = new PrismaClient({
  adapter,
});

export type PrismaTransaction = Omit<
  typeof prisma,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

export const cerrarPrisma = () => prisma.$disconnect();
