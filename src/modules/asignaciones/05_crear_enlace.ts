import type { Request, Response } from 'express';
import { prisma, type PrismaTransaction } from '../../db';
import { EstadoAsignacionAuditoria, type RolUsuario } from '../../generated/prisma/enums';
import { generarTokenSeguro, hashSha256 } from '../../utils/crypto';
import { conflicto, noAutenticado, noEncontrado, prohibido, solicitudInvalida } from '../../utils/errores';
import { validarObjetivoRealizableMasAntiguo } from '../../utils/objetivos_periodo';
import { calcularCierreConGracia } from '../../utils/periodos';
import { puedeAdministrar5S } from '../../utils/permisos';
import { responder, responderCreado } from '../../utils/respuesta';
import { transaccionSerializable } from '../../utils/transaccion';
import { registrarAuditoria } from '../registros_auditoria/helper';
import { esquemaCrearEnlace, esquemaId } from './zod';

const selectEnlaceSeguro = {
  id: true,
  expiraEn: true,
  usadoEn: true,
  revocadoEn: true,
  creadoEn: true,
} as const;

const assertPuedeGestionarInvitacion = async (
  tx: PrismaTransaction | typeof prisma,
  asignacionAuditoriaId: number,
  usuarioId: number,
  rol?: RolUsuario,
) => {
  const asignacion = await tx.asignacionAuditoria.findUniqueOrThrow({
    where: { id: asignacionAuditoriaId },
    include: {
      objetivoAuditoria: {
        include: {
          envioResultado: true,
        },
      },
    },
  });

  const esAdmin = puedeAdministrar5S(rol);
  if (!esAdmin && asignacion.auditorId !== usuarioId) {
    throw prohibido('La asignacion no pertenece al auditor autenticado');
  }

  if (
    asignacion.estado === EstadoAsignacionAuditoria.CANCELADA
    || asignacion.estado === EstadoAsignacionAuditoria.COMPLETADA
    || asignacion.estado === EstadoAsignacionAuditoria.VENCIDA
    || asignacion.objetivoAuditoria.envioResultadoId
  ) {
    throw solicitudInvalida('Esta auditoria ya no esta disponible para compartir');
  }

  await validarObjetivoRealizableMasAntiguo(tx, asignacion.objetivoAuditoriaId, new Date(), asignacion.reabiertaHasta);
  return asignacion;
};

const calcularExpiracionMaxima = (asignacion: Awaited<ReturnType<typeof assertPuedeGestionarInvitacion>>) => {
  const cierreConGracia = calcularCierreConGracia(asignacion.objetivoAuditoria.terminaEn);
  if (asignacion.reabiertaHasta && asignacion.reabiertaHasta > cierreConGracia) return asignacion.reabiertaHasta;
  return cierreConGracia;
};

const obtenerUsuarioAutenticado = (req: Request) => {
  const usuarioId = req.autenticacion?.usuarioId;
  if (!usuarioId) throw noAutenticado();
  return usuarioId;
};

export const obtenerEnlaceInvitadoActivo = async (req: Request, res: Response) => {
  const { id: asignacionAuditoriaId } = esquemaId.parse(req.params);
  const usuarioId = obtenerUsuarioAutenticado(req);

  await assertPuedeGestionarInvitacion(prisma, asignacionAuditoriaId, usuarioId, req.autenticacion?.rol);

  const enlace = await prisma.enlaceInvitado.findFirst({
    where: {
      asignacionAuditoriaId,
      revocadoEn: null,
      usadoEn: null,
      expiraEn: { gt: new Date() },
    },
    select: selectEnlaceSeguro,
    orderBy: { creadoEn: 'desc' },
  });

  responder(res, { enlace });
};

export const crearEnlaceInvitado = async (req: Request, res: Response) => {
  const { id: asignacionAuditoriaId } = esquemaId.parse(req.params);
  const body = esquemaCrearEnlace.parse(req.body ?? {});
  const usuarioId = obtenerUsuarioAutenticado(req);
  const token = generarTokenSeguro(32);

  const enlace = await transaccionSerializable(async (tx) => {
    const asignacion = await assertPuedeGestionarInvitacion(tx, asignacionAuditoriaId, usuarioId, req.autenticacion?.rol);
    const expiracionMaxima = calcularExpiracionMaxima(asignacion);
    const expiraEn = body.expiraEn && body.expiraEn < expiracionMaxima ? body.expiraEn : expiracionMaxima;
    if (expiraEn <= new Date()) throw conflicto('El periodo ya no permite crear invitaciones');

    await tx.enlaceInvitado.updateMany({
      where: {
        asignacionAuditoriaId,
        revocadoEn: null,
        usadoEn: null,
        expiraEn: { gt: new Date() },
      },
      data: { revocadoEn: new Date() },
    });

    const creado = await tx.enlaceInvitado.create({
      data: {
        asignacionAuditoriaId,
        creadoPorId: usuarioId,
        hashToken: hashSha256(token),
        expiraEn,
      },
      select: selectEnlaceSeguro,
    });

    await registrarAuditoria({ usuarioId, accion: 'CREAR_ENLACE_INVITADO', tipoEntidad: 'EnlaceInvitado', idEntidad: creado.id }, tx);
    return creado;
  });

  responderCreado(res, { enlace, token });
};

export const revocarEnlaceInvitadoActivo = async (req: Request, res: Response) => {
  const { id: asignacionAuditoriaId } = esquemaId.parse(req.params);
  const usuarioId = obtenerUsuarioAutenticado(req);

  await assertPuedeGestionarInvitacion(prisma, asignacionAuditoriaId, usuarioId, req.autenticacion?.rol);

  const actualizado = await prisma.enlaceInvitado.updateMany({
    where: {
      asignacionAuditoriaId,
      revocadoEn: null,
      usadoEn: null,
      expiraEn: { gt: new Date() },
    },
    data: { revocadoEn: new Date() },
  });

  if (!actualizado.count) throw noEncontrado('No hay invitacion activa para revocar');

  await registrarAuditoria({ usuarioId, accion: 'REVOCAR_ENLACE_INVITADO', tipoEntidad: 'AsignacionAuditoria', idEntidad: asignacionAuditoriaId });
  responder(res, { revocado: true });
};
