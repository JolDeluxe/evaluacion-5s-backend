import type { Request, Response } from 'express';
import { prisma } from '../../db';
import { hashSha256 } from '../../utils/crypto';
import { noEncontrado } from '../../utils/errores';
import { validarObjetivoRealizableMasAntiguo } from '../../utils/objetivos_periodo';
import { construirDetalleAuditorPeriodo } from '../../utils/periodos';
import { responder } from '../../utils/respuesta';
import { esquemaToken } from '../auditorias/zod';

export const obtenerInvitacion = async (req: Request, res: Response) => {
  const { token } = esquemaToken.parse(req.params);
  const enlace = await prisma.enlaceInvitado.findUnique({
    where: { hashToken: hashSha256(token) },
    include: {
      asignacionAuditoria: {
        include: {
          objetivoAuditoria: {
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
          },
        },
      },
    },
  });
  if (!enlace || enlace.revocadoEn || enlace.expiraEn <= new Date()) throw noEncontrado('Enlace no valido');

  const objetivo = enlace.asignacionAuditoria.objetivoAuditoria;
  await validarObjetivoRealizableMasAntiguo(prisma, objetivo.id);

  responder(res, {
    invitacion: {
      id: enlace.id,
      expiraEn: enlace.expiraEn,
      asignacion: {
        id: enlace.asignacionAuditoria.id,
        venceEn: enlace.asignacionAuditoria.venceEn,
        objetivo,
      },
      objetivo,
      area: objetivo.area,
      ciclo: objetivo.cicloAuditoria,
      versionFormulario: objetivo.formularioCiclo.versionFormulario,
      periodo: construirDetalleAuditorPeriodo(objetivo),
    },
  });
};
