import { Router } from 'express';
import { autenticar } from '../../middlewares/autenticacion';
import { autorizarRoles } from '../../middlewares/autorizacion';
import { ROLES_ADMIN_NEGOCIO, ROLES_QUE_CONSULTAN_AUDITORIAS, ROLES_QUE_EJECUTAN_AUDITORIAS } from '../../utils/permisos';
import { listarAsignaciones } from './01_listar';
import { crearEnlaceInvitado, obtenerEnlaceInvitadoActivo, revocarEnlaceInvitadoActivo } from './05_crear_enlace';
import { obtenerContextoAuditoriaAsignacion } from './07_contexto_auditoria';
import { obtenerAsignacionesMensuales } from './08_mensual';
import { guardarAsignacionMensualArea } from './09_guardar_mensual';
import { autoasignarMensual } from './10_autoasignar_mensual';
import { obtenerCargaMensual } from './11_carga_mensual';
import { reabrirAsignacion } from './12_reabrir';
import { confirmarAutoasignacion, generarPropuestaAutoasignacion } from './13_autoasignar_propuesta';

export const asignacionesRouter = Router();

asignacionesRouter.use(autenticar);
asignacionesRouter.get('/mensual', autorizarRoles(...ROLES_ADMIN_NEGOCIO), obtenerAsignacionesMensuales);
asignacionesRouter.get('/mensual/carga', autorizarRoles(...ROLES_ADMIN_NEGOCIO), obtenerCargaMensual);
asignacionesRouter.post('/mensual/autoasignar', autorizarRoles(...ROLES_ADMIN_NEGOCIO), autoasignarMensual);
asignacionesRouter.post('/mensual/autoasignar/propuesta', autorizarRoles(...ROLES_ADMIN_NEGOCIO), generarPropuestaAutoasignacion);
asignacionesRouter.post('/mensual/autoasignar/confirmar', autorizarRoles(...ROLES_ADMIN_NEGOCIO), confirmarAutoasignacion);
asignacionesRouter.put('/mensual/:areaId', autorizarRoles(...ROLES_ADMIN_NEGOCIO), guardarAsignacionMensualArea);
asignacionesRouter.get('/', autorizarRoles(...ROLES_QUE_CONSULTAN_AUDITORIAS), listarAsignaciones);
asignacionesRouter.get('/:id/auditoria', autorizarRoles(...ROLES_QUE_EJECUTAN_AUDITORIAS), obtenerContextoAuditoriaAsignacion);
asignacionesRouter.get('/:id/enlaces-invitado/activo', autorizarRoles(...ROLES_QUE_EJECUTAN_AUDITORIAS), obtenerEnlaceInvitadoActivo);
asignacionesRouter.post('/:id/enlaces-invitado', autorizarRoles(...ROLES_QUE_EJECUTAN_AUDITORIAS), crearEnlaceInvitado);
asignacionesRouter.delete('/:id/enlaces-invitado/activo', autorizarRoles(...ROLES_QUE_EJECUTAN_AUDITORIAS), revocarEnlaceInvitadoActivo);
asignacionesRouter.post('/:id/reabrir', autorizarRoles(...ROLES_ADMIN_NEGOCIO), reabrirAsignacion);
