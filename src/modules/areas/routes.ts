import { Router } from 'express';
import { autenticar } from '../../middlewares/autenticacion';
import { autorizarRoles } from '../../middlewares/autorizacion';
import { ROLES_ADMIN_NEGOCIO } from '../../utils/permisos';
import { listarAreas } from './01_listar';
import { crearArea } from './02_crear';
import { actualizarArea } from './03_actualizar';
import { cambiarEstadoArea, obtenerImpactoDesactivacionArea } from './04_estado';
import { guardarUsuarioArea } from './05_usuario_area';
import { eliminarUsuarioArea } from './07_eliminar_usuario_area';
import { imagenCodigoArea, obtenerCodigoArea, rotarCodigoArea } from './06_codigo';

export const areasRouter = Router();

areasRouter.use(autenticar);
areasRouter.get('/', listarAreas);
areasRouter.post('/', autorizarRoles(...ROLES_ADMIN_NEGOCIO), crearArea);
areasRouter.get('/:id/codigo-verificacion', autorizarRoles(...ROLES_ADMIN_NEGOCIO), obtenerCodigoArea);
areasRouter.get('/:id/codigo-verificacion/qr', autorizarRoles(...ROLES_ADMIN_NEGOCIO), imagenCodigoArea);
areasRouter.post('/:id/codigo-verificacion/rotar', autorizarRoles(...ROLES_ADMIN_NEGOCIO), rotarCodigoArea);
areasRouter.get('/:id/desactivacion-impacto', autorizarRoles(...ROLES_ADMIN_NEGOCIO), obtenerImpactoDesactivacionArea);
areasRouter.patch('/:id', autorizarRoles(...ROLES_ADMIN_NEGOCIO), actualizarArea);
areasRouter.post('/:id/desactivar', autorizarRoles(...ROLES_ADMIN_NEGOCIO), cambiarEstadoArea(false));
areasRouter.post('/:id/reactivar', autorizarRoles(...ROLES_ADMIN_NEGOCIO), cambiarEstadoArea(true));
areasRouter.put('/:id/usuarios', autorizarRoles(...ROLES_ADMIN_NEGOCIO), guardarUsuarioArea);
areasRouter.delete('/:id/usuarios', autorizarRoles(...ROLES_ADMIN_NEGOCIO), eliminarUsuarioArea);
