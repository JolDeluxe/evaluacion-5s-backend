import type { Request, Response } from 'express';
import { z } from 'zod';
import { responder } from '../../utils/respuesta';
import { transaccionSerializable } from '../../utils/transaccion';
import { registrarAuditoria } from '../registros_auditoria/helper';

const esquemaParams = z.object({ id: z.coerce.number().int().positive() });
const esquemaBody = z.object({ motivoInvalidacion: z.string().trim().min(1).max(5000) });

export const invalidarAuditoria = async (req: Request, res: Response) => {
  const { id } = esquemaParams.parse(req.params);
  const body = esquemaBody.parse(req.body);
  const envio = await transaccionSerializable(async (tx) => {
    const anterior = await tx.envioAuditoria.findUniqueOrThrow({ where: { id }, include: { objetivoAuditoria: true } });
    const actualizado = await tx.envioAuditoria.update({
      where: { id },
      data: { invalidadoEn: new Date(), motivoInvalidacion: body.motivoInvalidacion },
    });
    if (anterior.objetivoAuditoria.envioResultadoId === id) {
      const reemplazo = await tx.envioAuditoria.findFirst({
        where: {
          objetivoAuditoriaId: anterior.objetivoAuditoriaId,
          id: { not: id },
          invalidadoEn: null,
        },
        orderBy: { recibidoEn: 'desc' },
        select: { id: true },
      });
      await tx.objetivoAuditoria.update({
        where: { id: anterior.objetivoAuditoriaId },
        data: { envioResultadoId: reemplazo?.id ?? null },
      });
    }
    await registrarAuditoria({ usuarioId: req.autenticacion?.usuarioId, accion: 'INVALIDAR_AUDITORIA', tipoEntidad: 'EnvioAuditoria', idEntidad: id, datosAnteriores: anterior, datosNuevos: actualizado }, tx);
    return actualizado;
  });
  responder(res, { envio });
};
