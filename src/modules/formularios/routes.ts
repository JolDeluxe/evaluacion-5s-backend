import { Router } from 'express';
import { autenticar } from '../../middlewares/autenticacion';
import { autorizarRoles } from '../../middlewares/autorizacion';
import { ROLES_ADMIN_NEGOCIO } from '../../utils/permisos';
import { listarFormularios } from './01_listar';
import { crearFormulario } from './02_crear';
import { guardarEstructuraFormulario } from './03_guardar_estructura';
import { listarVersiones } from './07_versiones';
import { obtenerFormulario } from './08_obtener';
import { obtenerVersionFormulario } from './09_obtener_version';
import { firmarImagenFormulario } from './11_firmar_imagen';
import { actualizarFormulario } from './12_actualizar';

export const formulariosRouter = Router();

formulariosRouter.use(autenticar);
formulariosRouter.use(autorizarRoles(...ROLES_ADMIN_NEGOCIO));
formulariosRouter.get('/', listarFormularios);
formulariosRouter.get('/versiones/:versionId', obtenerVersionFormulario);
formulariosRouter.post('/versiones/:versionId/imagenes/firmar', firmarImagenFormulario);
formulariosRouter.get('/:id', obtenerFormulario);
formulariosRouter.patch('/:id', actualizarFormulario);
formulariosRouter.get('/:id/versiones', listarVersiones);
formulariosRouter.post('/', crearFormulario);
formulariosRouter.post('/:id/versiones', guardarEstructuraFormulario);
