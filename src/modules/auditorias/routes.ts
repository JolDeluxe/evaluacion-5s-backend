import { Router } from 'express';
import { autenticar } from '../../middlewares/autenticacion';
import { autorizarRoles } from '../../middlewares/autorizacion';
import { ROLES_ADMIN_NEGOCIO, ROLES_QUE_CONSULTAN_AUDITORIAS, ROLES_QUE_EJECUTAN_AUDITORIAS } from '../../utils/permisos';
import { enviarAuditoria } from './01_enviar';
import { obtenerAuditoria } from './02_obtener';
import { cambiarEnvioOficial } from './03_cambiar_oficial';
import { invalidarAuditoria } from './04_invalidar';
import { listarAuditorias } from './05_listar';

export const auditoriasRouter = Router();

auditoriasRouter.use(autenticar);
auditoriasRouter.get('/', autorizarRoles(...ROLES_QUE_CONSULTAN_AUDITORIAS), listarAuditorias);
auditoriasRouter.post('/', autorizarRoles(...ROLES_QUE_EJECUTAN_AUDITORIAS), enviarAuditoria);
auditoriasRouter.get('/:id', autorizarRoles(...ROLES_QUE_CONSULTAN_AUDITORIAS), obtenerAuditoria);
auditoriasRouter.post('/:id/invalidar', autorizarRoles(...ROLES_ADMIN_NEGOCIO), invalidarAuditoria);
auditoriasRouter.post('/objetivos/:objetivoId/oficial/:envioId', autorizarRoles(...ROLES_ADMIN_NEGOCIO), cambiarEnvioOficial);
