import type { Request, Response } from 'express';
import { prisma } from '../../db';
import { noEncontrado } from '../../utils/errores';
import { obtenerObjetivoRealizableMasAntiguo } from '../../utils/objetivos_periodo';
import { construirDetalleAuditorPeriodo, construirPeriodoCompat } from '../../utils/periodos';
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
  });

  const contextoInvitadoToken = crearContextoInvitadoPublico({
    objetivoAuditoriaId: objetivo.id,
    areaId: objetivo.areaId,
    nombreInvitado: body.nombre.trim(),
  });

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
    contextoInvitadoToken,
    objetivo,
    area: objetivo.area,
    ciclo: construirPeriodoCompat(objetivo),
    versionFormulario,
    periodo: construirDetalleAuditorPeriodo(objetivo),
    codigoVerificacionRequerido: true,
  });
};
