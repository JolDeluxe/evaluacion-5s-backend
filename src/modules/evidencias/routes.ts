import { Router } from 'express';
import { autenticar } from '../../middlewares/autenticacion';
import { autorizarRoles } from '../../middlewares/autorizacion';
import { ROLES_QUE_EJECUTAN_AUDITORIAS } from '../../utils/permisos';
import { firmarEvidencia } from './01_firmar';
import { listarEvidenciasEnvio } from './02_listar_envio';

export const evidenciasRouter = Router();

evidenciasRouter.use(autenticar);
evidenciasRouter.post('/firmar', autorizarRoles(...ROLES_QUE_EJECUTAN_AUDITORIAS), firmarEvidencia);
evidenciasRouter.get('/envios/:envioId', listarEvidenciasEnvio);
