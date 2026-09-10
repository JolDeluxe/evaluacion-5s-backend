import { Router } from 'express';
import { RolUsuario } from '../../generated/prisma/enums';
import { autenticar } from '../../middlewares/autenticacion';
import { autorizarRoles } from '../../middlewares/autorizacion';
import { obtenerCumplimientosMensual } from './01_mensual';
import { obtenerCumplimientoUsuario } from './02_usuario';
import { recalcularCumplimientos } from './03_recalcular';

export const cumplimientosRouter = Router();

cumplimientosRouter.use(autenticar);

// Consulta disponible para todos los roles con cuenta (incluido VISUALIZADOR)
cumplimientosRouter.get('/mensual', obtenerCumplimientosMensual);
cumplimientosRouter.get('/usuario/:id', obtenerCumplimientoUsuario);

// Recalcular solo para administradores
cumplimientosRouter.post(
  '/recalcular',
  autorizarRoles(RolUsuario.SUPER_ADMIN, RolUsuario.ADMINISTRADOR),
  recalcularCumplimientos,
);
