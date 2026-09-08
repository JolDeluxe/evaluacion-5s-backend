import { env } from '../config/env';

/**
 * Construye una URL absoluta del frontend a partir de la ruta dada.
 * Elimina el slash final de APP_PUBLIC_URL antes de concatenar.
 *
 * @example
 * appUrl('/mis-auditorias')
 * // → "https://5s-mbc.netlify.app/mis-auditorias"
 *
 * appUrl('/resultados/general?tipo=mes&mes=2026-08')
 * // → "https://5s-mbc.netlify.app/resultados/general?tipo=mes&mes=2026-08"
 */
export const appUrl = (path: string): string => {
  const base = env.APP_PUBLIC_URL.replace(/\/$/, '');
  const clean = path.startsWith('/') ? path : `/${path}`;
  return `${base}${clean}`;
};