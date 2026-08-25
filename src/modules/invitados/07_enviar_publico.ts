import type { Request, Response } from 'express';
import { OrigenEnvioAuditoria } from '../../generated/prisma/enums';
import { solicitudInvalida } from '../../utils/errores';
import { validarObjetivoRealizableMasAntiguo } from '../../utils/objetivos_periodo';
import { responder, responderCreado } from '../../utils/respuesta';
import { transaccionSerializable } from '../../utils/transaccion';
import { calcularPuntaje5S, validarCodigoArea, validarRespuestas5S } from '../auditorias/helper';
import { registrarAuditoria } from '../registros_auditoria/helper';
import { verificarContextoInvitadoPublico } from './token_publico';
import { esquemaEnviarInvitadoPublico } from './zod';

export const enviarAuditoriaInvitadoPublico = async (req: Request, res: Response) => {
  const body = esquemaEnviarInvitadoPublico.parse(req.body);
  const contexto = verificarContextoInvitadoPublico(body.contextoInvitadoToken);

  const existente = await transaccionSerializable(async (tx) => tx.envioAuditoria.findUnique({
    where: { identificadorCliente: body.identificadorCliente },
    include: { respuestasAuditoria: { include: { fotosAuditoria: true } } },
  }));
  if (existente) {
    responder(res, { envio: existente, idempotente: true });
    return;
  }

  const envio = await transaccionSerializable(async (tx) => {
    const verificadoEn = new Date();
    await validarObjetivoRealizableMasAntiguo(tx, contexto.objetivoAuditoriaId, verificadoEn);
    const objetivo = await tx.objetivoAuditoria.findUniqueOrThrow({
      where: { id: contexto.objetivoAuditoriaId },
      include: {
        area: true,
        formularioCiclo: {
          include: {
            versionFormulario: {
              include: { secciones: { include: { preguntas: true } } },
            },
          },
        },
      },
    });

    if (objetivo.areaId !== contexto.areaId) throw solicitudInvalida('Contexto invitado inconsistente');

    validarCodigoArea(objetivo.area.codigoVerificacion, body.codigoVerificacion);
    const preguntas = objetivo.formularioCiclo.versionFormulario.secciones.flatMap((seccion) => seccion.preguntas);
    validarRespuestas5S(preguntas, body.respuestas);
    const puntaje = calcularPuntaje5S(body.respuestas);

    const creado = await tx.envioAuditoria.create({
      data: {
        identificadorCliente: body.identificadorCliente,
        objetivoAuditoriaId: objetivo.id,
        asignacionAuditoriaId: null,
        enlaceInvitadoId: null,
        enviadoPorUsuarioId: null,
        nombreAuditorSnapshot: contexto.nombreInvitado,
        origen: OrigenEnvioAuditoria.INVITADO,
        puntajeObtenido: puntaje.puntajeObtenido,
        puntajePosible: puntaje.puntajePosible,
        porcentaje: puntaje.porcentaje,
        finalizadoEn: body.finalizadoEn,
        verificadoEn,
      },
    });

    for (const respuesta of body.respuestas) {
      const creadaRespuesta = await tx.respuestaAuditoria.create({
        data: {
          envioAuditoriaId: creado.id,
          preguntaFormularioId: respuesta.preguntaFormularioId,
          cumple: respuesta.cumple,
          hallazgo: respuesta.hallazgo ?? null,
        },
      });
      for (const foto of respuesta.fotos) {
        await tx.fotoAuditoria.create({
          data: {
            identificadorCliente: foto.identificadorCliente,
            respuestaAuditoriaId: creadaRespuesta.id,
            publicIdCloudinary: foto.publicIdCloudinary,
            assetIdCloudinary: foto.assetIdCloudinary ?? null,
            formato: foto.formato ?? null,
            tipoMime: foto.tipoMime ?? null,
            bytes: foto.bytes ?? null,
            ancho: foto.ancho ?? null,
            alto: foto.alto ?? null,
            capturadaEn: foto.capturadaEn ?? null,
            subidaEn: foto.subidaEn ?? null,
          },
        });
      }
    }

    await tx.objetivoAuditoria.updateMany({
      where: { id: objetivo.id, envioResultadoId: null },
      data: { envioResultadoId: creado.id },
    });
    await registrarAuditoria({
      accion: 'ENVIAR_AUDITORIA_INVITADO_PUBLICO',
      tipoEntidad: 'EnvioAuditoria',
      idEntidad: creado.id,
      datosNuevos: { id: creado.id, objetivoAuditoriaId: creado.objetivoAuditoriaId, origen: creado.origen },
    }, tx);

    return tx.envioAuditoria.findUniqueOrThrow({
      where: { id: creado.id },
      include: { respuestasAuditoria: { include: { fotosAuditoria: true } } },
    });
  });

  responderCreado(res, { envio });
};
