import { Router, type Request, type Response, type NextFunction } from 'express';
import { autenticar } from '../../middlewares/autenticacion';
import { autorizarRoles } from '../../middlewares/autorizacion';
import { RolUsuario } from '../../generated/prisma/enums';
import { prohibido } from '../../utils/errores';
import { ROLES_ADMIN_NEGOCIO, ROLES_RESULTADOS_GENERAL } from '../../utils/permisos';
import { resumenResultados } from './01_resumen';
import { resultadosAreas } from './03_areas';
import { historialArea } from './04_historial_area';
import { obtenerDetalleEnvio } from './05_detalle_envio';
import { resultadosGeneral } from './06_general';
import { resultadoArea } from './07_area';
import { resultadoPeriodo } from './08_periodo';
import { descargarResultadosGeneralPdf } from './09_descargar_pdf';
import { descargarResultadosGeneralPdfDirecto } from './10_descargar_pdf_directo';

export const resultadosRouter = Router();

// Descarga directa de PDF firmada con token para enlaces en correos (sin requerir login)
resultadosRouter.get('/reportes/general/pdf-directo', descargarResultadosGeneralPdfDirecto);

const bloquearVisualizador = (req: Request, _res: Response, next: NextFunction) => {
  if (req.autenticacion?.rol === RolUsuario.VISUALIZADOR) {
    throw prohibido('Los usuarios con rol VISUALIZADOR no tienen acceso al detalle de área');
  }
  next();
};

resultadosRouter.use(autenticar);
resultadosRouter.get('/general/pdf', autorizarRoles(...ROLES_ADMIN_NEGOCIO), descargarResultadosGeneralPdf);
resultadosRouter.get('/general', autorizarRoles(...ROLES_RESULTADOS_GENERAL), resultadosGeneral);
resultadosRouter.get('/resumen', autorizarRoles(...ROLES_ADMIN_NEGOCIO), resumenResultados);
resultadosRouter.get('/areas', resultadosAreas);
resultadosRouter.get('/areas/:areaId/periodos/:periodo', bloquearVisualizador, resultadoPeriodo);
resultadosRouter.get('/areas/:id/historial', bloquearVisualizador, historialArea);
resultadosRouter.get('/areas/:areaId', bloquearVisualizador, resultadoArea);
resultadosRouter.get('/envios/:id', bloquearVisualizador, obtenerDetalleEnvio);
