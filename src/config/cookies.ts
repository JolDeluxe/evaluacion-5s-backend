import type { CookieOptions, Response } from 'express';
import { env } from './env';

export const opcionesCookieSesion = (): CookieOptions => ({
  httpOnly: true,
  secure: env.NODE_ENV === 'production',
  sameSite: 'lax',
  path: '/',
  maxAge: env.SESION_DIAS_INACTIVIDAD * 24 * 60 * 60 * 1000,
});

export const establecerCookieSesion = (res: Response, token: string) => {
  res.cookie(env.SESION_NOMBRE_COOKIE, token, opcionesCookieSesion());
};

export const limpiarCookieSesion = (res: Response) => {
  res.clearCookie(env.SESION_NOMBRE_COOKIE, {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
  });
};
