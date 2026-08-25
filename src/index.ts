import { app, logger } from './app';
import { env } from './config/env';
import { cerrarPrisma } from './db';
import { iniciarJobsNotificaciones } from './modules/notificaciones/jobs';

const server = app.listen(env.PORT, () => {
  logger.info(`Servidor iniciado en puerto ${env.PORT} (${env.NODE_ENV})`);
});

const tareasNotificaciones = iniciarJobsNotificaciones();

server.on('error', (err: Error) => {
  logger.error(err, 'Failed to start the server');
  process.exit(1);
});

const gracefulShutdown = async () => {
  logger.info('Graceful shutdown initiated...');
  for (const tarea of tareasNotificaciones) tarea.stop();
  server.close(async () => {
    await cerrarPrisma();
    logger.info('HTTP server closed.');
    process.exit(0);
  });
};

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);
