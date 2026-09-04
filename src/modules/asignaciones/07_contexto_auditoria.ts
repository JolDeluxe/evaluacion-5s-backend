import type { Request, Response } from 'express';
import { prisma } from '../../db';
import { noAutenticado, prohibido } from '../../utils/errores';
import { puedeAdministrar5S, puedeEjecutarAuditoria } from '../../utils/permisos';
import { construirDetalleAdminPeriodo, construirDetalleAuditorPeriodo, construirPeriodoCompat } from '../../utils/periodos';
import { validarObjetivoRealizableMasAntiguo } from '../../utils/objetivos_periodo';
import { responder } from '../../utils/respuesta';
import { puedeUsarAsignacionEjecutable } from './helper';
import { esquemaId } from './zod';

const includeContextoFormulario = {
  area: true,
  envioResultado: true,
  versionFormulario: {
    include: {
      formulario: true,
      secciones: {
        orderBy: { orden: 'asc' as const },
        include: { preguntas: { orderBy: { orden: 'asc' as const } } },
      },
    },
  },
};


export const obtenerContextoAuditoriaAsignacion = async (req: Request, res: Response) => {
  if (!req.autenticacion) throw noAutenticado();
  const { id } = esquemaId.parse(req.params);

  const asignacion = await prisma.asignacionAuditoria.findUniqueOrThrow({
    where: { id },
    include: {
      auditor: { select: { id: true, nombre: true, nombreUsuario: true, rol: true } },
      objetivoAuditoria: { include: includeContextoFormulario },
    },
  });

  if (!puedeEjecutarAuditoria(req.autenticacion.rol)) {
    throw prohibido('Este rol no puede realizar auditorias');
  }

  const esAdmin = puedeAdministrar5S(req.autenticacion.rol);
  if (!puedeUsarAsignacionEjecutable(req.autenticacion, asignacion.auditorId)) {
    throw prohibido('La asignacion no pertenece al auditor autenticado');
  }

  await validarObjetivoRealizableMasAntiguo(prisma, asignacion.objetivoAuditoriaId, asignacion.auditorId, new Date(), asignacion.reabiertaHasta);

  const { versionFormulario } = asignacion.objetivoAuditoria;
  responder(res, {
    asignacion,
    objetivo: asignacion.objetivoAuditoria,
    area: asignacion.objetivoAuditoria.area,
    ciclo: construirPeriodoCompat(asignacion.objetivoAuditoria),
    versionFormulario,
    codigoVerificacionRequerido: true,
    periodo: esAdmin
      ? construirDetalleAdminPeriodo(asignacion.objetivoAuditoria, new Date(), asignacion.reabiertaHasta)
      : construirDetalleAuditorPeriodo(asignacion.objetivoAuditoria),
  });
};
