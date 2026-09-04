import { Router } from 'express';
import { autenticar } from '../../middlewares/autenticacion';
import { dashboardInicio } from './01_dashboard';

export const inicioRouter = Router();

inicioRouter.use(autenticar);
inicioRouter.get('/dashboard', dashboardInicio);
