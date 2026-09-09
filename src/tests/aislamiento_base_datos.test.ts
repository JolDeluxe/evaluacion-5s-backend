import { describe, expect, test } from 'bun:test';
import { env } from '../config/env';

describe('Aislamiento de Base de Datos para Tests', () => {
  test('NODE_ENV es test y la base de datos efectiva es estrictamente encuestas_5s_test', () => {
    const rawUrl =
      env.NODE_ENV === 'test'
        ? process.env.DATABASE_URL_TEST || env.DATABASE_URL_TEST || env.DATABASE_URL
        : env.DATABASE_URL;

    const parsed = new URL(rawUrl);
    const dbName = parsed.pathname.replace(/^\//, '');

    console.log(`[TEST CHECK] NODE_ENV: ${env.NODE_ENV} | Base de datos efectiva: ${dbName}`);

    expect(env.NODE_ENV).toBe('test');
    expect(dbName).toBe('encuestas_5s_test');
    expect(dbName).not.toBe('encuestas_5s');
  });
});
