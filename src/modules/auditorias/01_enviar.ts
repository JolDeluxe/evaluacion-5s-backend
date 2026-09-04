import type { Request, Response } from 'express';
import { EstadoAsignacionAuditoria, OrigenEnvioAuditoria } from '../../generated/prisma/enums';
import { conflicto, prohibido, solicitudInvalida } from '../../utils/errores';
import { puedeEjecutarAuditoria } from '../../utils/permisos';
import { validarObjetivoRealizableMasAntiguo } from '../../utils/objetivos_periodo';
import { responder, responderCreado } from '../../utils/respuesta';
import { transaccionSerializable } from '../../utils/transaccion';
import { registrarAuditoria } from '../registros_auditoria/helper';
import { calcularPuntaje5S, validarCodigoArea, validarRespuestas5S } from './helper';
import { esquemaEnviarAuditoria } from './zod';

export const enviarAuditoria = async (req: Request, res: Response) => {
  const body = esquemaEnviarAuditoria.parse(req.body);
  const usuarioId = req.autenticacion?.usuarioId;
  if (!usuarioId) throw prohibido();
  if (!puedeEjecutarAuditoria(req.autenticacion?.rol)) throw prohibido('Este rol no puede realizar auditorias');

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
    if (!body.asignacionAuditoriaId) throw solicitudInvalida('asignacionAuditoriaId es requerido');
    const asignacion = await tx.asignacionAuditoria.findUniqueOrThrow({
      where: { id: body.asignacionAuditoriaId },
      include: {
        objetivoAuditoria: {
          include: {
            area: true,
            versionFormulario: {
              include: {
                secciones: {
                  include: { preguntas: true },
                },
              },
            },
          },
        },
      },
    });
    if (asignacion.auditorId !== usuarioId) throw prohibido('La asignacion no pertenece al auditor autenticado');
    if (asignacion.estado === EstadoAsignacionAuditoria.CANCELADA) {
      throw solicitudInvalida('Esta auditoría ya no es requerida porque el área fue desactivada.');
    }
    if (
      asignacion.estado === EstadoAsignacionAuditoria.COMPLETADA
      || asignacion.estado === EstadoAsignacionAuditoria.VENCIDA
      || asignacion.objetivoAuditoria.envioResultadoId
    ) {
      throw solicitudInvalida('Esta auditoria ya fue completada.');
    }

    const objetivo = asignacion.objetivoAuditoria;
    await validarObjetivoRealizableMasAntiguo(tx, objetivo.id, usuarioId, verificadoEn, asignacion.reabiertaHasta);

    const perteneceAlArea = await tx.usuarioArea.findFirst({
      where: { usuarioId, areaId: objetivo.areaId },
      select: { id: true },
    });
    if (perteneceAlArea) throw prohibido('No puedes auditar tu propia area');

    validarCodigoArea(objetivo.area.codigoVerificacion, body.codigoVerificacion);
    const preguntas = objetivo.versionFormulario.secciones.flatMap((seccion) => seccion.preguntas);
    validarRespuestas5S(preguntas, body.respuestas);
    const puntaje = calcularPuntaje5S(body.respuestas);

    const creado = await tx.envioAuditoria.create({
      data: {
        identificadorCliente: body.identificadorCliente,
        objetivoAuditoriaId: objetivo.id,
        asignacionAuditoriaId: asignacion.id,
        enviadoPorUsuarioId: usuarioId,
        nombreAuditorSnapshot: body.nombreAuditorSnapshot,
        origen: OrigenEnvioAuditoria.USUARIO,
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

    const oficial = await tx.objetivoAuditoria.updateMany({
      where: { id: objetivo.id, envioResultadoId: null },
      data: { envioResultadoId: creado.id },
    });
    if (!oficial.count) throw conflicto('Esta auditoria ya fue completada.');
    await tx.asignacionAuditoria.update({
      where: { id: asignacion.id },
      data: { estado: EstadoAsignacionAuditoria.COMPLETADA, completadoEn: new Date() },
    });
    await tx.enlaceInvitado.updateMany({
      where: {
        asignacionAuditoriaId: asignacion.id,
        revocadoEn: null,
        usadoEn: null,
      },
      data: { revocadoEn: new Date() },
    });

    await registrarAuditoria({ usuarioId, accion: 'ENVIAR_AUDITORIA', tipoEntidad: 'EnvioAuditoria', idEntidad: creado.id, datosNuevos: creado }, tx);
    return tx.envioAuditoria.findUniqueOrThrow({
      where: { id: creado.id },
      include: { respuestasAuditoria: { include: { fotosAuditoria: true } } },
    });
  });

  responderCreado(res, { envio });
};
