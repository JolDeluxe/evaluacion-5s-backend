import { Router } from 'express';
import { autenticar } from '../../middlewares/autenticacion';
import { listarNotificaciones } from './01_listar';
import { registrarSuscripcionPush } from './02_push';
import { marcarLeida } from './03_leer';

export const notificacionesRouter = Router();

notificacionesRouter.use(autenticar);
notificacionesRouter.get('/', listarNotificaciones);
notificacionesRouter.post('/push', registrarSuscripcionPush);
notificacionesRouter.post('/:id/leida', marcarLeida);
