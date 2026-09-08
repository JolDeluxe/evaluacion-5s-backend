import type { ICachePlugin, TokenCacheContext } from '@azure/msal-node';
import { prisma } from '../../../db';
import { desencriptarTokenEmail, encriptarTokenEmail } from '../../../utils/cifrado-token-email';

export const CLAVE_CACHE_MSAL = 'microsoft_graph_token_cache';
export const CLAVE_CONEXION_MSAL = 'microsoft_graph_connection_info';

export const msalDbCachePlugin: ICachePlugin = {
  async beforeCacheAccess(tokenCacheContext: TokenCacheContext): Promise<void> {
    try {
      const registro = await prisma.secretoSistema.findUnique({
        where: { clave: CLAVE_CACHE_MSAL },
      });
      if (registro && registro.valorCifrado) {
        const cacheJson = desencriptarTokenEmail(registro.valorCifrado);
        tokenCacheContext.tokenCache.deserialize(cacheJson);
      }
    } catch (error) {
      // Si la BD aún no tiene caché o hubo error de deserialización, continuar con caché vacía
      console.warn('[MSAL-CACHE] Advertencia al leer caché cifrada desde BD:', error instanceof Error ? error.message : error);
    }
  },

  async afterCacheAccess(tokenCacheContext: TokenCacheContext): Promise<void> {
    if (tokenCacheContext.cacheHasChanged) {
      try {
        const cacheJson = tokenCacheContext.tokenCache.serialize();
        const valorCifrado = encriptarTokenEmail(cacheJson);
        await prisma.secretoSistema.upsert({
          where: { clave: CLAVE_CACHE_MSAL },
          create: {
            clave: CLAVE_CACHE_MSAL,
            valorCifrado,
            metadatos: { actualizadoEn: new Date().toISOString() },
          },
          update: {
            valorCifrado,
            metadatos: { actualizadoEn: new Date().toISOString() },
          },
        });
      } catch (error) {
        console.error('[MSAL-CACHE] Error al guardar caché cifrada en BD:', error instanceof Error ? error.message : error);
      }
    }
  },
};