import type { Request, Response } from 'express';
import { responder } from '../../utils/respuesta';
import { transaccionSerializable } from '../../utils/transaccion';
import { sincronizarObjetivosPendientesDeArea } from '../asignaciones/helper';
import { registrarAuditoria } from '../registros_auditoria/helper';
import { esquemaActualizarArea, esquemaId } from './zod';

export const actualizarArea = async (req: Request, res: Response) => {
  const { id } = esquemaId.parse(req.params);
  const body = esquemaActualizarArea.parse(req.body);
  const { area, sincronizacion } = await transaccionSerializable(async (tx) => {
    const anterior = await tx.area.findUniqueOrThrow({ where: { id } });
    const actualizado = await tx.area.update({
      where: { id },
      data: {
        ...(body.codigo ? { codigo: body.codigo.trim().toUpperCase() } : {}),
        ...(body.nombre ? { nombre: body.nombre.trim() } : {}),
        ...(body.tipo ? { tipo: body.tipo } : {}),
      },
    });

    const cambioAtributosSnapshot =
      anterior.tipo !== actualizado.tipo
      || anterior.codigo !== actualizado.codigo
      || anterior.nombre !== actualizado.nombre;

    const resultadoSincronizacion = cambioAtributosSnapshot
      ? await sincronizarObjetivosPendientesDeArea(tx, actualizado)
      : {
          versionFormularioId: null,
          formularioId: null,
          objetivosActualizados: 0,
          objetivosIds: [] as number[],
        };

    await registrarAuditoria(
      {
        usuarioId: req.autenticacion?.usuarioId,
        accion: 'ACTUALIZAR_AREA',
        tipoEntidad: 'Area',
        idEntidad: id,
        datosAnteriores: anterior,
        datosNuevos: {
          ...actualizado,
          sincronizacionObjetivos: resultadoSincronizacion,
        },
      },
      tx,
    );
    return { area: actualizado, sincronizacion: resultadoSincronizacion };
  });
  responder(res, { area, sincronizacion });
};
