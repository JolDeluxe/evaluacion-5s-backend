import type { Request, Response } from 'express';
import { responder } from '../../utils/respuesta';
import { transaccionSerializable } from '../../utils/transaccion';
import { liberarAsignacionesDeAuditorNoEjecutable } from '../asignaciones/servicio_reasignacion';
import { registrarAuditoria } from '../registros_auditoria/helper';
import { esquemaId, esquemaUsuarioArea } from './zod';

export const guardarUsuarioArea = async (req: Request, res: Response) => {
  const { id: areaId } = esquemaId.parse(req.params);
  const body = esquemaUsuarioArea.parse(req.body);
  const resultado = await transaccionSerializable(async (tx) => {
    const guardada = await tx.usuarioArea.upsert({
      where: { usuarioId_areaId: { usuarioId: body.usuarioId, areaId } },
      update: {},
      create: { usuarioId: body.usuarioId, areaId },
      include: { usuario: { select: { id: true, nombre: true, nombreUsuario: true, rol: true } }, area: true },
    });
    const impacto = await liberarAsignacionesDeAuditorNoEjecutable(
      tx,
      body.usuarioId,
      'AUDITOR_EN_SU_PROPIA_AREA',
      areaId,
    );
    await registrarAuditoria({ usuarioId: req.autenticacion?.usuarioId, accion: 'GUARDAR_USUARIO_AREA', tipoEntidad: 'UsuarioArea', idEntidad: guardada.id, datosNuevos: guardada }, tx);
    return { relacion: guardada, impacto };
  });
  responder(res, resultado);
};
