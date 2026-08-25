import { Router } from 'express';
import { autenticar } from '../../middlewares/autenticacion';
import { autorizarRoles } from '../../middlewares/autorizacion';
import { ROLES_ADMIN_NEGOCIO } from '../../utils/permisos';
import { listarCiclos } from './01_listar';
import { crearCiclo } from './02_crear';
import { publicarCiclo } from './03_publicar';

export const ciclosRouter = Router();

ciclosRouter.use(autenticar);
ciclosRouter.get('/', listarCiclos);
ciclosRouter.post('/', autorizarRoles(...ROLES_ADMIN_NEGOCIO), crearCiclo);
ciclosRouter.post('/:id/publicar', autorizarRoles(...ROLES_ADMIN_NEGOCIO), publicarCiclo);
