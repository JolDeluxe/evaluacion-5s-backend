import { Router } from 'express';
import { autenticar } from '../../middlewares/autenticacion';
import { autorizarRoles } from '../../middlewares/autorizacion';
import { ROLES_ADMIN_NEGOCIO } from '../../utils/permisos';
import { listarUsuarios } from './01_listar';
import { crearUsuario } from './02_crear';
import { actualizarUsuario } from './03_actualizar';
import { desactivarUsuario } from './04_desactivar';
import { reactivarUsuario } from './05_reactivar';
import { establecerContrasenaTemporal } from './06_contrasena_temporal';

export const usuariosRouter = Router();

usuariosRouter.use(autenticar, autorizarRoles(...ROLES_ADMIN_NEGOCIO));
usuariosRouter.get('/', listarUsuarios);
usuariosRouter.post('/', crearUsuario);
usuariosRouter.patch('/:id', actualizarUsuario);
usuariosRouter.post('/:id/desactivar', desactivarUsuario);
usuariosRouter.post('/:id/reactivar', reactivarUsuario);
usuariosRouter.post('/:id/contrasena-temporal', establecerContrasenaTemporal);
