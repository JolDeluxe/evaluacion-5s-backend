import type { Request, Response } from 'express';
import { EstadoAsignacionAuditoria, OrigenEnvioAuditoria } from '../../generated/prisma/enums';
import { hashSha256 } from '../../utils/crypto';
import { conflicto, noEncontrado, solicitudInvalida } from '../../utils/errores';
import { validarObjetivoRealizableMasAntiguo } from '../../utils/objetivos_periodo';
import { responder, responderCreado } from '../../utils/respuesta';
import { transaccionSerializable } from '../../utils/transaccion';
import { calcularPuntaje5S, validarCodigoArea, validarRespuestas5S } from '../auditorias/helper';
import { esquemaEnviarAuditoria, esquemaToken } from '../auditorias/zod';
import { registrarAuditoria } from '../registros_auditoria/helper';

export const enviarAuditoriaInvitado = async (req: Request, res: Response) => {
  const { token } = esquemaToken.parse(req.params);
  const body = esquemaEnviarAuditoria.parse(req.body);
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
    const enlace = await tx.enlaceInvitado.findUnique({
      where: { hashToken: hashSha256(token) },
      include: {
        asignacionAuditoria: {
          include: {
            auditor: { select: { id: true, nombre: true } },
            objetivoAuditoria: {
              include: {
                area: true,
                versionFormulario: {
                  include: {
                    secciones: { include: { preguntas: true } },
                  },
                },
              },
            },
          },
        },
      },
    });
    if (!enlace || enlace.revocadoEn || enlace.expiraEn <= new Date()) throw noEncontrado('Enlace no valido');
    if (enlace.usadoEn) {
      throw solicitudInvalida('Esta invitacion ya fue utilizada.');
    }
    if (enlace.asignacionAuditoria.estado === EstadoAsignacionAuditoria.CANCELADA) {
      throw solicitudInvalida('Esta auditoría ya no es requerida porque el área fue desactivada.');
    }
    if (
      enlace.asignacionAuditoria.estado === EstadoAsignacionAuditoria.COMPLETADA
      || enlace.asignacionAuditoria.estado === EstadoAsignacionAuditoria.VENCIDA
      || enlace.asignacionAuditoria.objetivoAuditoria.envioResultadoId
    ) {
      throw solicitudInvalida('Esta auditoria ya fue completada.');
    }

    const objetivo = enlace.asignacionAuditoria.objetivoAuditoria;
    await validarObjetivoRealizableMasAntiguo(tx, objetivo.id, verificadoEn, enlace.asignacionAuditoria.reabiertaHasta);

    validarCodigoArea(objetivo.area.codigoVerificacion, body.codigoVerificacion);
    const preguntas = objetivo.versionFormulario.secciones.flatMap((seccion) => seccion.preguntas);
    validarRespuestas5S(preguntas, body.respuestas);
    const puntaje = calcularPuntaje5S(body.respuestas);
    const usuarioSesion = req.autenticacion?.usuarioId
      ? await tx.usuario.findUnique({ where: { id: req.autenticacion.usuarioId }, select: { id: true, nombre: true } })
      : null;
    const nombreAuditorSnapshot = usuarioSesion?.nombre?.trim() || body.nombreAuditorSnapshot.trim();

    const creado = await tx.envioAuditoria.create({
      data: {
        identificadorCliente: body.identificadorCliente,
        objetivoAuditoriaId: objetivo.id,
        asignacionAuditoriaId: enlace.asignacionAuditoriaId,
        enviadoPorUsuarioId: usuarioSesion?.id ?? null,
        enlaceInvitadoId: enlace.id,
        nombreAuditorSnapshot,
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

    await tx.enlaceInvitado.update({ where: { id: enlace.id }, data: { usadoEn: new Date() } });
    await tx.enlaceInvitado.updateMany({
      where: {
        asignacionAuditoriaId: enlace.asignacionAuditoriaId,
        id: { not: enlace.id },
        revocadoEn: null,
        usadoEn: null,
      },
      data: { revocadoEn: new Date() },
    });
    await tx.asignacionAuditoria.update({ where: { id: enlace.asignacionAuditoriaId }, data: { estado: EstadoAsignacionAuditoria.COMPLETADA, completadoEn: new Date() } });
    const oficial = await tx.objetivoAuditoria.updateMany({ where: { id: objetivo.id, envioResultadoId: null }, data: { envioResultadoId: creado.id } });
    if (!oficial.count) throw conflicto('Esta auditoria ya fue completada.');
    await registrarAuditoria({ accion: 'ENVIAR_AUDITORIA_INVITADO', tipoEntidad: 'EnvioAuditoria', idEntidad: creado.id, datosNuevos: creado }, tx);
    return tx.envioAuditoria.findUniqueOrThrow({
      where: { id: creado.id },
      include: { respuestasAuditoria: { include: { fotosAuditoria: true } } },
    });
  });
  responderCreado(res, { envio });
};
