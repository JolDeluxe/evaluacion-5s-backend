import { Router } from 'express';
import { RolUsuario } from '../../generated/prisma/enums';
import { autenticar } from '../../middlewares/autenticacion';
import { autorizarRoles } from '../../middlewares/autorizacion';
import { listarRegistrosAuditoria } from './01_listar';

export const registrosAuditoriaRouter = Router();

registrosAuditoriaRouter.use(autenticar, autorizarRoles(RolUsuario.SUPER_ADMIN));
registrosAuditoriaRouter.get('/', listarRegistrosAuditoria);
