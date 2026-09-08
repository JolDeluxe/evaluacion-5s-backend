import type { Request, Response } from 'express';
import { responder } from '../../utils/respuesta';
import {
  desconectarMicrosoft,
  iniciarDeviceCodeFlow,
  obtenerEstadoConexionMicrosoft,
} from '../notificaciones/proveedores/microsoft-graph';
import { registrarAuditoria } from '../registros_auditoria/helper';

export const estadoConexionMicrosoftSistema = async (_req: Request, res: Response) => {
  const estado = await obtenerEstadoConexionMicrosoft();
  responder(res, { microsoft: estado });
};

export const iniciarConexionMicrosoftSistema = async (req: Request, res: Response) => {
  const deviceCodeData = await iniciarDeviceCodeFlow();

  await registrarAuditoria({
    usuarioId: req.autenticacion?.usuarioId,
    accion: 'MICROSOFT_DEVICE_CODE_INICIADO',
    tipoEntidad: 'Sistema',
  });

  responder(res, {
    mensaje: 'Flujo de código de dispositivo iniciado. Ingresa a la URL indicada e introduce el código.',
    deviceCode: deviceCodeData,
  });
};

export const desconectarMicrosoftSistema = async (req: Request, res: Response) => {
  await desconectarMicrosoft();

  await registrarAuditoria({
    usuarioId: req.autenticacion?.usuarioId,
    accion: 'MICROSOFT_CUENTA_DESCONECTADA',
    tipoEntidad: 'Sistema',
  });

  responder(res, {
    mensaje: 'Cuenta de Microsoft desconectada y caché de tokens eliminada exitosamente.',
  });
};