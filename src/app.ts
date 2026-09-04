import express, { type Request, type Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import compression from 'compression';
import { pinoHttp } from 'pino-http';
import pino from 'pino';
import { env, frontendOriginsPermitidos } from './config/env';
import { prisma } from './db';
import { validarOrigen } from './middlewares/validar_origen';
import { manejoErrores, noEncontradoHandler } from './middlewares/manejo_errores';
import { generarUuid } from './utils/crypto';
import { authRouter } from './modules/auth/routes';
import { usuariosRouter } from './modules/usuarios/routes';
import { areasRouter } from './modules/areas/routes';
import { formulariosRouter } from './modules/formularios/routes';
import { asignacionesRouter } from './modules/asignaciones/routes';
import { invitadosRouter } from './modules/invitados/routes';
import { auditoriasRouter } from './modules/auditorias/routes';
import { evidenciasRouter } from './modules/evidencias/routes';
import { notificacionesRouter } from './modules/notificaciones/routes';
import { resultadosRouter } from './modules/resultados/routes';
import { registrosAuditoriaRouter } from './modules/registros_auditoria/routes';
import { sistemaRouter } from './modules/sistema/routes';
import { inicioRouter } from './modules/inicio/routes';
import { qrRouter } from './modules/qr/routes';

const esDesarrollo = env.NODE_ENV === 'development';

const redact = [
  'req.headers.cookie',
  'req.headers.authorization',
  'res.headers["set-cookie"]',
  '*.token',
  '*.tokens',
  '*.accessToken',
  '*.refreshToken',
  '*.hashContrasena',
  '*.hashToken',
  '*.private_key',
  '*.COOKIE_SECRET',
  '*.INVITADO_PUBLICO_SECRET',
  '*.codigoVerificacion',
  '*.contextoInvitadoToken',
  '*.firma',
];

const logger = pino({
  level: env.NODE_ENV === 'production' ? 'info' : 'debug',
  redact,
  ...(esDesarrollo
    ? {
        transport: {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'HH:MM:ss.l',
            ignore: 'pid,hostname',
            singleLine: false,
          },
        },
      }
    : {}),
});

const sanitizarUrl = (url?: string) => (
  url
    ?.replace(/\/api\/v1\/invitados\/[^/?]+/g, '/api/v1/invitados/[redacted]')
    .replace(/([?&](?:codigo|codigoVerificacion)=)[^&]+/g, '$1[redacted]')
);

const app = express();

if (env.PROXY_CONFIANZA === 'loopback') {
  app.set('trust proxy', 'loopback');
}

app.use(helmet());

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || frontendOriginsPermitidos.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(null, false);
    },
    credentials: true,
  })
);

app.use(compression());

app.use(
  pinoHttp({
    logger,
    customLogLevel: (_req, res, err) => {
      if (err || res.statusCode >= 500) return 'error';
      if (res.statusCode >= 400) return 'warn';
      return 'info';
    },
    customSuccessMessage: (req, res) => `${req.method} ${sanitizarUrl(req.url)} ${res.statusCode}`,
    customErrorMessage: (req, res) => `${req.method} ${sanitizarUrl(req.url)} ${res.statusCode}`,
    serializers: {
      req(req) {
        return {
          method: req.method,
          url: sanitizarUrl(req.url),
          requestId: req.id,
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
      err(err) {
        const estado = typeof err === 'object' && err && 'estado' in err ? Number(err.estado) : undefined;
        const statusCode = estado || (typeof err === 'object' && err && 'statusCode' in err ? Number(err.statusCode) : undefined);
        const codigo = typeof err === 'object' && err && 'codigo' in err ? String(err.codigo) : undefined;

        if (esDesarrollo && statusCode && statusCode < 500) {
          return {
            type: err.name,
            message: err.message,
            statusCode,
            codigo,
          };
        }

        return pino.stdSerializers.err(err);
      },
    },
    genReqId: (req) => req.headers['x-request-id']?.toString() ?? generarUuid(),
    customProps: (req, res) => {
      req.idPeticion = String(req.id);
      return {
        requestId: String(req.id),
        ...(res.locals.codigoError ? { codigo: res.locals.codigoError } : {}),
      };
    },
  })
);

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(cookieParser(env.COOKIE_SECRET));
app.use(validarOrigen);

app.get('/api/health', (req: Request, res: Response) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    env: env.NODE_ENV,
  });
});

app.get('/api/ready', async (_req: Request, res: Response) => {
  await prisma.$queryRaw`SELECT 1`;
  res.json({ status: 'ready', timestamp: new Date().toISOString() });
});

app.use('/api/v1/auth', authRouter);
app.use('/api/v1/usuarios', usuariosRouter);
app.use('/api/v1/areas', areasRouter);
app.use('/api/v1/formularios', formulariosRouter);
app.use('/api/v1/asignaciones', asignacionesRouter);
app.use('/api/v1/invitados', invitadosRouter);
app.use('/api/v1/auditorias', auditoriasRouter);
app.use('/api/v1/evidencias', evidenciasRouter);
app.use('/api/v1/notificaciones', notificacionesRouter);
app.use('/api/v1/resultados', resultadosRouter);
app.use('/api/v1/registros-auditoria', registrosAuditoriaRouter);
app.use('/api/v1/sistema', sistemaRouter);
app.use('/api/v1/inicio', inicioRouter);
app.use('/api/v1/qr', qrRouter);

app.use(noEncontradoHandler);
app.use(manejoErrores);

export { app, logger };
