import { Router } from 'express';
import { RolUsuario } from '../../generated/prisma/enums';
import { autenticar } from '../../middlewares/autenticacion';
import { autorizarRoles } from '../../middlewares/autorizacion';
import { listarDelegaciones } from './01_listar';
import { crearDelegacion } from './02_crear';
import { actualizarDelegacion } from './03_actualizar';
import { eliminarDelegacion } from './04_eliminar';

export const delegacionesRouter = Router();

delegacionesRouter.use(autenticar);
delegacionesRouter.use(autorizarRoles(RolUsuario.SUPER_ADMIN, RolUsuario.ADMINISTRADOR));

delegacionesRouter.get('/', listarDelegaciones);
delegacionesRouter.post('/', crearDelegacion);
delegacionesRouter.put('/:id', actualizarDelegacion);
delegacionesRouter.delete('/:id', eliminarDelegacion);
