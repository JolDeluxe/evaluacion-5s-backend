import type { Request, Response } from 'express';
import { prisma } from '../../db';
import { noEncontrado } from '../../utils/errores';
import { obtenerObjetivoRealizableMasAntiguo } from '../../utils/objetivos_periodo';
import { construirDetalleAuditorPeriodo } from '../../utils/periodos';
import { responder } from '../../utils/respuesta';
import { asegurarInvitadoPublicoHabilitado, crearContextoInvitadoPublico } from './token_publico';
import { esquemaIniciarInvitadoPublico } from './zod';

export const iniciarInvitadoPublico = async (req: Request, res: Response) => {
  asegurarInvitadoPublicoHabilitado();
  const body = esquemaIniciarInvitadoPublico.parse(req.body);
  const objetivoBase = await obtenerObjetivoRealizableMasAntiguo(prisma, body.areaId);
  if (!objetivoBase) throw noEncontrado('El area no tiene un periodo disponible para auditar');

  const objetivo = await prisma.objetivoAuditoria.findUniqueOrThrow({
    where: { id: objetivoBase.id },
    include: {
      area: true,
      envioResultado: true,
      cicloAuditoria: true,
      formularioCiclo: {
        include: {
          versionFormulario: {
            include: {
              formulario: true,
              secciones: {
                orderBy: { orden: 'asc' },
                include: { preguntas: { orderBy: { orden: 'asc' } } },
              },
            },
          },
        },
      },
    },
  });

  const contextoInvitadoToken = crearContextoInvitadoPublico({
    objetivoAuditoriaId: objetivo.id,
    areaId: objetivo.areaId,
    nombreInvitado: body.nombre.trim(),
  });

  responder(res, {
    contextoInvitadoToken,
    objetivo,
    area: objetivo.area,
    ciclo: objetivo.cicloAuditoria,
    versionFormulario: objetivo.formularioCiclo.versionFormulario,
    periodo: construirDetalleAuditorPeriodo(objetivo),
    codigoVerificacionRequerido: true,
  });
};
