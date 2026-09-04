import type { Request, Response } from 'express';
import { prisma } from '../../db';
import { EstadoAsignacionAuditoria } from '../../generated/prisma/enums';
import { hashSha256 } from '../../utils/crypto';
import { noEncontrado, solicitudInvalida } from '../../utils/errores';
import { validarObjetivoRealizableMasAntiguo } from '../../utils/objetivos_periodo';
import { construirDetalleAuditorPeriodo, construirPeriodoCompat } from '../../utils/periodos';
import { responder } from '../../utils/respuesta';
import { esquemaToken } from '../auditorias/zod';

export const obtenerInvitacion = async (req: Request, res: Response) => {
  const { token } = esquemaToken.parse(req.params);
  const enlace = await prisma.enlaceInvitado.findUnique({
    where: { hashToken: hashSha256(token) },
    include: {
      asignacionAuditoria: {
        include: {
          auditor: { select: { id: true, nombre: true, nombreUsuario: true } },
          objetivoAuditoria: {
            include: {
              area: true,
              envioResultado: true,
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
  });
  if (!enlace || enlace.revocadoEn || enlace.expiraEn <= new Date()) throw noEncontrado('Enlace no valido');
  if (enlace.usadoEn) throw solicitudInvalida('Esta invitacion ya fue utilizada.');
  if (enlace.asignacionAuditoria.estado === EstadoAsignacionAuditoria.COMPLETADA || enlace.asignacionAuditoria.objetivoAuditoria.envioResultadoId) {
    throw solicitudInvalida('Esta auditoria ya fue completada.');
  }

  const objetivo = enlace.asignacionAuditoria.objetivoAuditoria;
  await validarObjetivoRealizableMasAntiguo(prisma, objetivo.id, enlace.asignacionAuditoria.auditorId);

  let versionFormulario = objetivo.versionFormulario;
  if (!objetivo.envioResultadoId) {
    const versionActiva = await prisma.versionFormulario.findFirst({
      where: { formularioId: versionFormulario.formularioId, activa: true },
      include: {
        formulario: true,
        secciones: {
          orderBy: { orden: 'asc' },
          include: { preguntas: { orderBy: { orden: 'asc' } } },
        },
      },
    });
    if (versionActiva) {
      versionFormulario = versionActiva;
      if (objetivo.versionFormularioId !== versionActiva.id) {
        await prisma.objetivoAuditoria.update({
          where: { id: objetivo.id },
          data: { versionFormularioId: versionActiva.id },
        });
        objetivo.versionFormularioId = versionActiva.id;
        objetivo.versionFormulario = versionActiva;
      }
    }
  }

  responder(res, {
    invitacion: {
      id: enlace.id,
      expiraEn: enlace.expiraEn,
      asignacion: {
        id: enlace.asignacionAuditoria.id,
        venceEn: enlace.asignacionAuditoria.venceEn,
        auditor: enlace.asignacionAuditoria.auditor,
        objetivo,
      },
      objetivo,
      area: objetivo.area,
      ciclo: construirPeriodoCompat(objetivo),
      versionFormulario,
      periodo: construirDetalleAuditorPeriodo(objetivo),
    },
  });
};
