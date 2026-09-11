import type { Request, Response } from 'express';
import { EstadoAsignacionAuditoria, OrigenEnvioAuditoria, RolUsuario } from '../../generated/prisma/enums';
import { conflicto, prohibido, solicitudInvalida } from '../../utils/errores';
import { puedeEjecutarAuditoria } from '../../utils/permisos';
import { calcularCierreConGracia } from '../../utils/periodos';
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

    const usuarioAutenticado = await tx.usuario.findUniqueOrThrow({
      where: { id: usuarioId },
      select: { id: true, rol: true, esComodin: true, nombre: true },
    });

    const esAuditorTitular = asignacion.auditorId === usuarioId;
    const esComodinValido = usuarioAutenticado.rol === RolUsuario.ADMINISTRADOR && usuarioAutenticado.esComodin;

    if (!esAuditorTitular && !esComodinValido) {
      throw prohibido('La asignacion no pertenece al auditor autenticado');
    }

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

    if (!esAuditorTitular && esComodinValido) {
      const cierreGracia = calcularCierreConGracia(objetivo.terminaEn);
      if (verificadoEn < objetivo.iniciaEn || verificadoEn > cierreGracia) {
        throw solicitudInvalida('El administrador comodín solo puede intervenir en periodos en curso o en periodo de gracia');
      }
    }

    await validarObjetivoRealizableMasAntiguo(
      tx,
      objetivo.id,
      esAuditorTitular ? usuarioId : null,
      verificadoEn,
      asignacion.reabiertaHasta,
    );

    if (!esComodinValido) {
      const perteneceAlArea = await tx.usuarioArea.findFirst({
        where: { usuarioId, areaId: objetivo.areaId },
        select: { id: true },
      });
      if (perteneceAlArea) throw prohibido('No puedes auditar tu propia area');
    }

    let versionFormulario = objetivo.versionFormulario;
    if (!objetivo.envioResultadoId) {
      const versionActiva = await tx.versionFormulario.findFirst({
        where: { formularioId: versionFormulario.formularioId, activa: true },
        include: { secciones: { include: { preguntas: true } } },
      });
      if (versionActiva) {
        versionFormulario = versionActiva as typeof objetivo.versionFormulario;
        if (objetivo.versionFormularioId !== versionActiva.id) {
          await tx.objetivoAuditoria.update({
            where: { id: objetivo.id },
            data: { versionFormularioId: versionActiva.id },
          });
        }
      }
    }

    validarCodigoArea(objetivo.area.codigoVerificacion, body.codigoVerificacion);
    const preguntas = versionFormulario.secciones.flatMap((seccion) => seccion.preguntas);
    validarRespuestas5S(preguntas, body.respuestas);
    const puntaje = calcularPuntaje5S(body.respuestas);

    const ahoraServidor = new Date();
    const terminaEnDate = new Date(objetivo.terminaEn); // garantiza Date aunque Prisma devuelva string
    const realizadaATiempo = ahoraServidor.getTime() <= terminaEnDate.getTime();

    const creado = await tx.envioAuditoria.create({
      data: {
        identificadorCliente: body.identificadorCliente,
        objetivoAuditoriaId: objetivo.id,
        asignacionAuditoriaId: asignacion.id,
        enviadoPorUsuarioId: usuarioId,
        nombreAuditorSnapshot: body.nombreAuditorSnapshot || usuarioAutenticado.nombre,
        origen: OrigenEnvioAuditoria.USUARIO,
        puntajeObtenido: puntaje.puntajeObtenido,
        puntajePosible: puntaje.puntajePosible,
        porcentaje: puntaje.porcentaje,
        realizadaATiempo,
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

    await registrarAuditoria({
      usuarioId,
      accion: esAuditorTitular ? 'ENVIAR_AUDITORIA' : 'ENVIAR_AUDITORIA_COMODIN',
      tipoEntidad: 'EnvioAuditoria',
      idEntidad: creado.id,
      datosNuevos: {
        ...creado,
        ejecutadoComoComodin: !esAuditorTitular,
        auditorTitularId: asignacion.auditorId,
      },
    }, tx);
    return tx.envioAuditoria.findUniqueOrThrow({
      where: { id: creado.id },
      include: { respuestasAuditoria: { include: { fotosAuditoria: true } } },
    });
  });

  responderCreado(res, { envio });
};
