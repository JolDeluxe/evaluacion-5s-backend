import { Router } from 'express';
import { RolUsuario } from '../../generated/prisma/enums';
import { autenticar } from '../../middlewares/autenticacion';
import { autorizarRoles } from '../../middlewares/autorizacion';
import { resumenSistema } from './01_resumen';
import { listarSesionesSistema } from './02_sesiones';
import { revocarSesionSistema } from './03_revocar_sesion';
import { listarEntregasNotificacionSistema } from './04_entregas_notificacion';
import { reintentarEntregaNotificacionSistema } from './05_reintentar_entrega_notificacion';
import { resumenCorreosSistema } from './06_correos_resumen';
import { estadoCorreosSistema } from './07_correos_estado';
import { reenviarEntregaCorreoSistema } from './08_reenviar_entrega';
import { simularCorreosSistema } from './09_simular_correos';
import { previewCorreoSistema } from './10_preview_correo';
import { enviarPruebaCorreoSistema } from './11_enviar_prueba_correo';
import {
  desconectarMicrosoftSistema,
  estadoConexionMicrosoftSistema,
  iniciarConexionMicrosoftSistema,
} from './12_microsoft_conexion';

export const sistemaRouter = Router();

sistemaRouter.use(autenticar, autorizarRoles(RolUsuario.SUPER_ADMIN));
sistemaRouter.get('/resumen', resumenSistema);
sistemaRouter.get('/sesiones', listarSesionesSistema);
sistemaRouter.post('/sesiones/:id/revocar', revocarSesionSistema);
sistemaRouter.get('/entregas-notificacion', listarEntregasNotificacionSistema);
sistemaRouter.post('/entregas-notificacion/:id/reintentar', reintentarEntregaNotificacionSistema);
sistemaRouter.get('/correos/resumen', resumenCorreosSistema);
sistemaRouter.get('/correos/estado', estadoCorreosSistema);
sistemaRouter.post('/correos/reenviar/:id', reenviarEntregaCorreoSistema);
sistemaRouter.get('/correos/simular', simularCorreosSistema);
sistemaRouter.get('/correos/preview', previewCorreoSistema);
sistemaRouter.post('/correos/enviar-prueba', enviarPruebaCorreoSistema);
sistemaRouter.get('/correos/microsoft/estado', estadoConexionMicrosoftSistema);
sistemaRouter.post('/correos/microsoft/iniciar', iniciarConexionMicrosoftSistema);
sistemaRouter.post('/correos/microsoft/desconectar', desconectarMicrosoftSistema);


