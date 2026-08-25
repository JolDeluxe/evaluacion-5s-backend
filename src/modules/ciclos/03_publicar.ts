import type { Request, Response } from 'express';
import { EstadoCicloAuditoria } from '../../generated/prisma/enums';
import { conflicto } from '../../utils/errores';
import { responder } from '../../utils/respuesta';
import { transaccionSerializable } from '../../utils/transaccion';
import { registrarAuditoria } from '../registros_auditoria/helper';
import { esquemaId } from './zod';

export const publicarCiclo = async (req: Request, res: Response) => {
  const { id } = esquemaId.parse(req.params);
  const resultado = await transaccionSerializable(async (tx) => {
    const ciclo = await tx.cicloAuditoria.findUniqueOrThrow({
      where: { id },
      include: { formulariosCiclo: true },
    });
    if (ciclo.estado !== EstadoCicloAuditoria.BORRADOR) throw conflicto('Solo se puede publicar un ciclo en BORRADOR');

    for (const formularioCiclo of ciclo.formulariosCiclo) {
      const areas = await tx.area.findMany({ where: { tipo: formularioCiclo.tipoArea, activo: true } });
      for (const area of areas) {
        await tx.objetivoAuditoria.upsert({
          where: { cicloAuditoriaId_areaId: { cicloAuditoriaId: ciclo.id, areaId: area.id } },
          update: {},
          create: {
            cicloAuditoriaId: ciclo.id,
            formularioCicloId: formularioCiclo.id,
            areaId: area.id,
            codigoAreaSnapshot: area.codigo,
            nombreAreaSnapshot: area.nombre,
            tipoAreaSnapshot: area.tipo,
          },
        });
      }
    }

    const actualizado = await tx.cicloAuditoria.update({
      where: { id },
      data: { estado: EstadoCicloAuditoria.PUBLICADO, publicadoEn: new Date() },
      include: { objetivosAuditoria: true, formulariosCiclo: true },
    });
    await registrarAuditoria({ usuarioId: req.autenticacion?.usuarioId, accion: 'PUBLICAR_CICLO', tipoEntidad: 'CicloAuditoria', idEntidad: id, datosNuevos: actualizado }, tx);
    return actualizado;
  });
  responder(res, { ciclo: resultado });
};
