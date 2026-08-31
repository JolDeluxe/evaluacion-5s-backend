import type { Request, Response } from 'express';
import { prisma } from '../../db';
import { EstadoAsignacionAuditoria } from '../../generated/prisma/enums';
import { solicitudInvalida } from '../../utils/errores';
import { responder } from '../../utils/respuesta';
import { registrarAuditoria } from '../registros_auditoria/helper';
import { esquemaId, esquemaUsuarioArea } from './zod';

export const guardarUsuarioArea = async (req: Request, res: Response) => {
  const { id: areaId } = esquemaId.parse(req.params);
  const body = esquemaUsuarioArea.parse(req.body);
  const relacion = await prisma.$transaction(async (tx) => {
    const asignacionesVigentes = await tx.asignacionAuditoria.count({
      where: {
        auditorId: body.usuarioId,
        estado: { in: [EstadoAsignacionAuditoria.PENDIENTE, EstadoAsignacionAuditoria.EN_PROCESO] },
        objetivoAuditoria: { areaId },
      },
    });
    if (asignacionesVigentes > 0) {
      throw solicitudInvalida('El usuario tiene auditorias vigentes para esta area y no puede quedar como responsable');
    }

    const guardada = await tx.usuarioArea.upsert({
      where: { usuarioId_areaId: { usuarioId: body.usuarioId, areaId } },
      update: {},
      create: { usuarioId: body.usuarioId, areaId },
      include: { usuario: { select: { id: true, nombre: true, nombreUsuario: true, rol: true } }, area: true },
    });
    await registrarAuditoria({ usuarioId: req.autenticacion?.usuarioId, accion: 'GUARDAR_USUARIO_AREA', tipoEntidad: 'UsuarioArea', idEntidad: guardada.id, datosNuevos: guardada }, tx);
    return guardada;
  });
  responder(res, { relacion });
};
