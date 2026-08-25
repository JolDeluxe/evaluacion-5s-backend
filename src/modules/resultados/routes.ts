import { Router } from 'express';
import { autenticar } from '../../middlewares/autenticacion';
import { autorizarRoles } from '../../middlewares/autorizacion';
import { ROLES_ADMIN_NEGOCIO } from '../../utils/permisos';
import { resumenResultados } from './01_resumen';
import { resultadosCiclo } from './02_ciclo';
import { resultadosAreas } from './03_areas';
import { historialArea } from './04_historial_area';
import { obtenerDetalleEnvio } from './05_detalle_envio';

export const resultadosRouter = Router();

resultadosRouter.use(autenticar);
resultadosRouter.get('/resumen', resumenResultados);
resultadosRouter.get('/ciclos/:id', resultadosCiclo);
resultadosRouter.get('/areas', resultadosAreas);
resultadosRouter.get('/areas/:id/historial', historialArea);
resultadosRouter.get('/envios/:id', autorizarRoles(...ROLES_ADMIN_NEGOCIO), obtenerDetalleEnvio);

