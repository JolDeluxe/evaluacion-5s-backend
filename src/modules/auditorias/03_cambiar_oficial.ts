import type { Request, Response } from 'express';
import { z } from 'zod';
import { conflicto } from '../../utils/errores';
import { responder } from '../../utils/respuesta';
import { transaccionSerializable } from '../../utils/transaccion';
import { registrarAuditoria } from '../registros_auditoria/helper';

const esquemaParams = z.object({
  objetivoId: z.coerce.number().int().positive(),
  envioId: z.coerce.number().int().positive(),
});

export const cambiarEnvioOficial = async (req: Request, res: Response) => {
  const { objetivoId, envioId } = esquemaParams.parse(req.params);
  const resultado = await transaccionSerializable(async (tx) => {
    const objetivo = await tx.objetivoAuditoria.findUniqueOrThrow({ where: { id: objetivoId } });
    const envio = await tx.envioAuditoria.findUniqueOrThrow({ where: { id: envioId } });
    if (envio.objetivoAuditoriaId !== objetivo.id) throw conflicto('El envio no pertenece al objetivo');
    if (envio.invalidadoEn) throw conflicto('No se puede marcar como resultado un envio invalidado');

    const actualizado = await tx.objetivoAuditoria.update({
      where: { id: objetivo.id },
      data: { envioResultadoId: envio.id },
    });
    await registrarAuditoria({ usuarioId: req.autenticacion?.usuarioId, accion: 'CAMBIAR_ENVIO_RESULTADO', tipoEntidad: 'ObjetivoAuditoria', idEntidad: objetivo.id, datosAnteriores: objetivo, datosNuevos: actualizado }, tx);
    return { objetivo: actualizado, envio };
  });
  responder(res, resultado);
};
