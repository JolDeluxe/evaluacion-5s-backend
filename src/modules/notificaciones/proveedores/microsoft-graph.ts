import type { DeviceCodeRequest, SilentFlowRequest } from '@azure/msal-node';
import { InteractionRequiredAuthError, PublicClientApplication } from '@azure/msal-node';
import { env } from '../../../config/env';
import { prisma } from '../../../db';
import type { EmailInput, EmailResult } from './email-smtp';
import { construirMensajeMime } from './mime-builder';
import { CLAVE_CACHE_MSAL, CLAVE_CONEXION_MSAL, msalDbCachePlugin } from './msal-cache-plugin';

const SCOPES = ['https://graph.microsoft.com/Mail.Send', 'offline_access'];

let pcaInstance: PublicClientApplication | null = null;

export const getPublicClientApplication = (): PublicClientApplication | null => {
  if (!env.MICROSOFT_GRAPH_CLIENT_ID) return null;

  if (!pcaInstance) {
    pcaInstance = new PublicClientApplication({
      auth: {
        clientId: env.MICROSOFT_GRAPH_CLIENT_ID,
        authority: env.MICROSOFT_GRAPH_AUTHORITY,
      },
      cache: {
        cachePlugin: msalDbCachePlugin,
      },
    });
  }

  return pcaInstance;
};

// Variable en memoria para rastrear el flujo de Device Code en curso
let activeDeviceCodeSession: {
  userCode: string;
  verificationUri: string;
  message: string;
  expiresIn: number;
  iniciadoEn: number;
  expiraEn: number;
  completado: boolean;
  error: string | null;
} | null = null;

export const iniciarDeviceCodeFlow = async (): Promise<{
  userCode: string;
  verificationUri: string;
  message: string;
  expiresIn: number;
}> => {
  const pca = getPublicClientApplication();
  if (!pca) {
    throw new Error('MICROSOFT_GRAPH_CLIENT_ID no está configurado en las variables de entorno.');
  }

  return new Promise((resolve, reject) => {
    let resolved = false;

    const request: DeviceCodeRequest = {
      deviceCodeCallback: (response) => {
        activeDeviceCodeSession = {
          userCode: response.userCode,
          verificationUri: response.verificationUri,
          message: response.message,
          expiresIn: response.expiresIn,
          iniciadoEn: Date.now(),
          expiraEn: Date.now() + response.expiresIn * 1000,
          completado: false,
          error: null,
        };

        resolved = true;
        resolve({
          userCode: response.userCode,
          verificationUri: response.verificationUri,
          message: response.message,
          expiresIn: response.expiresIn,
        });
      },
      scopes: SCOPES,
    };

    pca
      .acquireTokenByDeviceCode(request)
      .then(async (response) => {
        if (activeDeviceCodeSession) {
          activeDeviceCodeSession.completado = true;
        }

        const correoConectado = response?.account?.username || env.MICROSOFT_GRAPH_SENDER_EMAIL || 'Cuenta conectada';
        await prisma.secretoSistema.upsert({
          where: { clave: CLAVE_CONEXION_MSAL },
          create: {
            clave: CLAVE_CONEXION_MSAL,
            valorCifrado: 'conectado',
            metadatos: {
              conectado: true,
              cuenta: correoConectado,
              nombre: response?.account?.name || null,
              conectadoEn: new Date().toISOString(),
              requiereReconexion: false,
            },
          },
          update: {
            valorCifrado: 'conectado',
            metadatos: {
              conectado: true,
              cuenta: correoConectado,
              nombre: response?.account?.name || null,
              conectadoEn: new Date().toISOString(),
              requiereReconexion: false,
            },
          },
        });
      })
      .catch(async (err) => {
        console.error('[MSAL] Error durante acquireTokenByDeviceCode:', err);
        if (activeDeviceCodeSession) {
          activeDeviceCodeSession.error = err instanceof Error ? err.message : String(err);
        }
        if (!resolved) {
          reject(err);
        }
      });
  });
};

export const obtenerEstadoConexionMicrosoft = async (): Promise<{
  configurado: boolean;
  conectado: boolean;
  cuenta: string | null;
  nombre: string | null;
  requiereReconexion: boolean;
  conectadoEn: string | null;
  sesionDeviceCode: {
    activa: boolean;
    userCode?: string;
    verificationUri?: string;
    expiraEnSegundos?: number;
  } | null;
}> => {
  const configurado = Boolean(env.MICROSOFT_GRAPH_CLIENT_ID);
  if (!configurado) {
    return {
      configurado: false,
      conectado: false,
      cuenta: null,
      nombre: null,
      requiereReconexion: false,
      conectadoEn: null,
      sesionDeviceCode: null,
    };
  }

  const registroConexion = await prisma.secretoSistema.findUnique({
    where: { clave: CLAVE_CONEXION_MSAL },
  });

  const metadatos = (registroConexion?.metadatos ?? {}) as {
    conectado?: boolean;
    cuenta?: string;
    nombre?: string;
    requiereReconexion?: boolean;
    conectadoEn?: string;
  };

  let sesionDeviceCode = null;
  if (activeDeviceCodeSession && !activeDeviceCodeSession.completado && Date.now() < activeDeviceCodeSession.expiraEn) {
    sesionDeviceCode = {
      activa: true,
      userCode: activeDeviceCodeSession.userCode,
      verificationUri: activeDeviceCodeSession.verificationUri,
      expiraEnSegundos: Math.max(0, Math.floor((activeDeviceCodeSession.expiraEn - Date.now()) / 1000)),
    };
  }

  return {
    configurado: true,
    conectado: Boolean(metadatos.conectado),
    cuenta: metadatos.cuenta ?? env.MICROSOFT_GRAPH_SENDER_EMAIL ?? null,
    nombre: metadatos.nombre ?? null,
    requiereReconexion: Boolean(metadatos.requiereReconexion),
    conectadoEn: metadatos.conectadoEn ?? null,
    sesionDeviceCode,
  };
};

export const desconectarMicrosoft = async (): Promise<void> => {
  pcaInstance = null;
  activeDeviceCodeSession = null;

  await prisma.secretoSistema.deleteMany({
    where: { clave: { in: [CLAVE_CACHE_MSAL, CLAVE_CONEXION_MSAL] } },
  });
};

const obtenerAccessTokenSilencioso = async (): Promise<string> => {
  const pca = getPublicClientApplication();
  if (!pca) {
    throw new Error('MICROSOFT_GRAPH_CLIENT_ID no configurado');
  }

  const accounts = await pca.getTokenCache().getAllAccounts();
  if (accounts.length === 0) {
    await marcarRequiereReconexion('No hay cuentas Microsoft almacenadas en la caché.');
    throw new Error('No hay cuenta Microsoft conectada. Se requiere iniciar sesión.');
  }

  const silentRequest: SilentFlowRequest = {
    account: accounts[0],
    scopes: SCOPES,
  };

  try {
    const authResult = await pca.acquireTokenSilent(silentRequest);
    return authResult.accessToken;
  } catch (error) {
    if (error instanceof InteractionRequiredAuthError) {
      await marcarRequiereReconexion('El consentimiento ha caducado o Microsoft requiere nueva interacción.');
    }
    throw error;
  }
};

const marcarRequiereReconexion = async (motivo: string) => {
  const registro = await prisma.secretoSistema.findUnique({
    where: { clave: CLAVE_CONEXION_MSAL },
  });
  const metaActual = (registro?.metadatos ?? {}) as Record<string, unknown>;

  await prisma.secretoSistema.upsert({
    where: { clave: CLAVE_CONEXION_MSAL },
    create: {
      clave: CLAVE_CONEXION_MSAL,
      valorCifrado: 'requiere_reconexion',
      metadatos: { ...metaActual, requiereReconexion: true, motivo },
    },
    update: {
      valorCifrado: 'requiere_reconexion',
      metadatos: { ...metaActual, requiereReconexion: true, motivo },
    },
  });
};

/**
 * Envía un correo electrónico a través de la API oficial de Microsoft Graph v1.0 (/me/sendMail).
 * Utiliza formato MIME RFC 2822 codificado en base64 para soportar HTML, texto plano y QR inline con CID.
 */
export const enviarCorreoMicrosoftGraph = async (input: EmailInput): Promise<EmailResult & { retryAfterSeconds?: number }> => {
  let accessToken: string;
  try {
    accessToken = await obtenerAccessTokenSilencioso();
  } catch (error) {
    return {
      enviado: false,
      error: error instanceof Error ? error.message : 'Error de autenticación con Microsoft Graph',
      permanente: false,
    };
  }

  let mimeBuffer: Buffer;
  try {
    mimeBuffer = await construirMensajeMime({
      from: env.MICROSOFT_GRAPH_SENDER_EMAIL,
      to: input.to,
      subject: input.subject,
      text: input.text,
      html: input.html,
      attachments: input.attachments,
    });
  } catch (mimeErr) {
    return {
      enviado: false,
      error: `Error al generar contenido MIME: ${mimeErr instanceof Error ? mimeErr.message : String(mimeErr)}`,
      permanente: true,
    };
  }

  try {
    const response = await fetch('https://graph.microsoft.com/v1.0/me/sendMail', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'text/plain',
      },
      body: mimeBuffer.toString('base64'),
    });

    if (response.status === 202) {
      // 202 Accepted: Aceptado por Microsoft Graph
      const requestId = response.headers.get('request-id') || response.headers.get('client-request-id') || 'graph-202-accepted';
      return {
        enviado: true,
        idMensajeExterno: requestId,
      };
    }

    // Manejo de códigos de error de Microsoft Graph
    if (response.status === 429) {
      const retryAfterHeader = response.headers.get('Retry-After');
      const retryAfterSeconds = retryAfterHeader ? Number.parseInt(retryAfterHeader, 10) : 60;
      return {
        enviado: false,
        error: `Microsoft Graph rate limit (429). Reintento en ${retryAfterSeconds}s`,
        permanente: false,
        retryAfterSeconds: Number.isNaN(retryAfterSeconds) ? 60 : retryAfterSeconds,
      };
    }

    if (response.status === 401) {
      await marcarRequiereReconexion('Token de Microsoft Graph rechazado (401 Unauthorized)');
      return {
        enviado: false,
        error: 'Sesión de Microsoft expirada o rechazada (401). Requiere reconexión.',
        permanente: false,
      };
    }

    const responseText = await response.text();
    let errorJson: { error?: { code?: string; message?: string } } | null = null;
    try {
      errorJson = JSON.parse(responseText);
    } catch {
      // No es JSON
    }

    const errorMsg = errorJson?.error?.message || responseText || `Error HTTP ${response.status} de Microsoft Graph`;
    const errorCode = errorJson?.error?.code || '';

    // 5xx = Server transient errors
    if (response.status >= 500 && response.status < 600) {
      return {
        enviado: false,
        error: `Error de servidor en Microsoft Graph (${response.status}): ${errorMsg}`,
        permanente: false,
      };
    }

    // Errores permanentes de cliente (400, destinatario inválido, etc.)
    const esPermanente = response.status >= 400 && response.status < 500 && response.status !== 401 && response.status !== 429;

    return {
      enviado: false,
      error: `[Graph ${errorCode || response.status}] ${errorMsg}`,
      permanente: esPermanente,
    };
  } catch (networkError) {
    return {
      enviado: false,
      error: `Error de red al conectar con Microsoft Graph: ${networkError instanceof Error ? networkError.message : String(networkError)}`,
      permanente: false,
    };
  }
};