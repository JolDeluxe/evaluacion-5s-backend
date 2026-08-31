import { Router } from 'express';
import { autenticar } from '../../middlewares/autenticacion';
import { autorizarRoles } from '../../middlewares/autorizacion';
import { ROLES_ADMIN_NEGOCIO } from '../../utils/permisos';
import { resumenResultados } from './01_resumen';
import { resultadosAreas } from './03_areas';
import { historialArea } from './04_historial_area';
import { obtenerDetalleEnvio } from './05_detalle_envio';
import { resultadosGeneral } from './06_general';
import { resultadoArea } from './07_area';
import { resultadoPeriodo } from './08_periodo';

export const resultadosRouter = Router();

resultadosRouter.use(autenticar);
resultadosRouter.get('/general', resultadosGeneral);
resultadosRouter.get('/resumen', autorizarRoles(...ROLES_ADMIN_NEGOCIO), resumenResultados);
resultadosRouter.get('/areas', resultadosAreas);
resultadosRouter.get('/areas/:areaId/periodos/:periodo', resultadoPeriodo);
resultadosRouter.get('/areas/:id/historial', historialArea);
resultadosRouter.get('/areas/:areaId', resultadoArea);
resultadosRouter.get('/envios/:id', obtenerDetalleEnvio);
