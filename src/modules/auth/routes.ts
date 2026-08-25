import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { autenticar } from '../../middlewares/autenticacion';
import { iniciarSesion } from './01_iniciar_sesion';
import { obtenerSesion } from './02_obtener_sesion';
import { cerrarSesion } from './03_cerrar_sesion';
import { cerrarTodasLasSesiones } from './04_cerrar_todas_las_sesiones';
import { solicitarRestablecimiento } from './05_solicitar_restablecimiento';
import { restablecerContrasena } from './06_restablecer_contrasena';
import { cambiarContrasena } from './07_cambiar_contrasena';

export const authRouter = Router();

const limiteLogin = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false });
const limiteReset = rateLimit({ windowMs: 60 * 60 * 1000, limit: 5, standardHeaders: true, legacyHeaders: false });

authRouter.post('/iniciar-sesion', limiteLogin, iniciarSesion);
authRouter.get('/me', autenticar, obtenerSesion);
authRouter.post('/cerrar-sesion', autenticar, cerrarSesion);
authRouter.post('/cerrar-todas-las-sesiones', autenticar, cerrarTodasLasSesiones);
authRouter.post('/solicitar-restablecimiento', limiteReset, solicitarRestablecimiento);
authRouter.post('/restablecer-contrasena', limiteReset, restablecerContrasena);
authRouter.post('/cambiar-contrasena', autenticar, cambiarContrasena);
