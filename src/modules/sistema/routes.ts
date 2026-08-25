import { Router } from 'express';
import { RolUsuario } from '../../generated/prisma/enums';
import { autenticar } from '../../middlewares/autenticacion';
import { autorizarRoles } from '../../middlewares/autorizacion';
import { resumenSistema } from './01_resumen';
import { listarSesionesSistema } from './02_sesiones';
import { revocarSesionSistema } from './03_revocar_sesion';
import { listarEntregasNotificacionSistema } from './04_entregas_notificacion';
import { reintentarEntregaNotificacionSistema } from './05_reintentar_entrega_notificacion';

export const sistemaRouter = Router();

sistemaRouter.use(autenticar, autorizarRoles(RolUsuario.SUPER_ADMIN));
sistemaRouter.get('/resumen', resumenSistema);
sistemaRouter.get('/sesiones', listarSesionesSistema);
sistemaRouter.post('/sesiones/:id/revocar', revocarSesionSistema);
sistemaRouter.get('/entregas-notificacion', listarEntregasNotificacionSistema);
sistemaRouter.post('/entregas-notificacion/:id/reintentar', reintentarEntregaNotificacionSistema);
