import { Router } from 'express';
import { autenticar } from '../../middlewares/autenticacion';
import { autorizarRoles } from '../../middlewares/autorizacion';
import { ROLES_ADMIN_NEGOCIO, ROLES_QUE_CONSULTAN_AUDITORIAS, ROLES_QUE_EJECUTAN_AUDITORIAS } from '../../utils/permisos';
import { listarAsignaciones } from './01_listar';
import { crearAsignacion } from './02_crear';
import { publicarAsignacion } from './03_publicar';
import { reasignar } from './04_reasignar';
import { crearEnlaceInvitado } from './05_crear_enlace';
import { obtenerContextoAuditoriaAsignacion } from './07_contexto_auditoria';

export const asignacionesRouter = Router();

asignacionesRouter.use(autenticar);
asignacionesRouter.get('/', autorizarRoles(...ROLES_QUE_CONSULTAN_AUDITORIAS), listarAsignaciones);
asignacionesRouter.get('/:id/auditoria', autorizarRoles(...ROLES_QUE_EJECUTAN_AUDITORIAS), obtenerContextoAuditoriaAsignacion);
asignacionesRouter.post('/', autorizarRoles(...ROLES_ADMIN_NEGOCIO), crearAsignacion);
asignacionesRouter.post('/:id/publicar', autorizarRoles(...ROLES_ADMIN_NEGOCIO), publicarAsignacion);
asignacionesRouter.post('/:id/reasignar', autorizarRoles(...ROLES_ADMIN_NEGOCIO), reasignar);
asignacionesRouter.post('/:id/enlaces-invitado', autorizarRoles(...ROLES_ADMIN_NEGOCIO), crearEnlaceInvitado);
