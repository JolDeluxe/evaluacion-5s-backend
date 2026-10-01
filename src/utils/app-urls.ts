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

/**
 * Sanea cualquier URL absoluta que contenga localhost o 127.0.0.1
 * sustituyéndola por la base pública configurada en APP_PUBLIC_URL.
 * Esto protege contra registros pre-generados en base de datos con localhost.
 */
export const sanearUrlPublica = (url?: string | null): string => {
  if (!url) return '';
  const publicBase = env.APP_PUBLIC_URL.replace(/\/$/, '');
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/i.test(url)) {
    return url.replace(/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/i, publicBase);
  }
  return url;
};