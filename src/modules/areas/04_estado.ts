import type { Request, Response } from 'express';
import { solicitudInvalida } from '../../utils/errores';
import { responder } from '../../utils/respuesta';
import { transaccionSerializable } from '../../utils/transaccion';
import { asegurarProgramacionMensual, guardarAsignacionMensual } from '../asignaciones/programacion_mensual';
import { registrarAuditoria } from '../registros_auditoria/helper';
import { esquemaActivarArea, esquemaDesactivarArea, esquemaId } from './zod';
import { obtenerImpactoDesactivacion, procesarDesactivacionArea, procesarReactivacionArea } from './servicio_vigencia_area';

export const obtenerImpactoDesactivacionArea = async (req: Request, res: Response) => {
  const { id } = esquemaId.parse(req.params);
  const impacto = await transaccionSerializable(async (tx) => obtenerImpactoDesactivacion(tx, id));
  responder(res, impacto);
};

export const cambiarEstadoArea = (activo: boolean) => async (req: Request, res: Response) => {
  const { id } = esquemaId.parse(req.params);
  const bodyActivar = activo ? esquemaActivarArea.parse(req.body) : null;
  const bodyDesactivar = !activo ? esquemaDesactivarArea.parse(req.body) : null;

  if (activo && bodyActivar?.inicioProgramaAuditoria === 'ESTE_MES' && !bodyActivar.auditorMensualId) {
    throw solicitudInvalida('Para incluir esta area en el mes actual debes seleccionar un auditor');
  }

  const resultado = await transaccionSerializable(async (tx) => {
    const ahora = new Date();
    const anterior = await tx.area.findUniqueOrThrow({ where: { id } });

    if (activo) {
      const areaActualizada = await procesarReactivacionArea(
        tx,
        id,
        bodyActivar?.inicioProgramaAuditoria ?? 'PROXIMO_MES',
        req.autenticacion?.usuarioId ?? 1,
      );

      if (bodyActivar?.inicioProgramaAuditoria === 'ESTE_MES' && bodyActivar.auditorMensualId) {
        await asegurarProgramacionMensual(tx, ahora.getFullYear(), ahora.getMonth() + 1, req.autenticacion?.usuarioId ?? 1);
        await guardarAsignacionMensual(tx, {
          areaId: id,
          anio: ahora.getFullYear(),
          mes: ahora.getMonth() + 1,
          auditorMensualId: bodyActivar.auditorMensualId,
          asignadoPorId: req.autenticacion?.usuarioId ?? 1,
        });
      }

      await registrarAuditoria({ usuarioId: req.autenticacion?.usuarioId, accion: 'REACTIVAR_AREA', tipoEntidad: 'Area', idEntidad: id, datosAnteriores: anterior, datosNuevos: areaActualizada }, tx);
      return { area: areaActualizada };
    }

    const { area: areaActualizada, objetivosCancelados, asignacionesCanceladas } = await procesarDesactivacionArea(
      tx,
      id,
      bodyDesactivar?.efectivaDesde ?? 'ESTE_MES',
      req.autenticacion?.usuarioId ?? 1,
    );

    await registrarAuditoria({
      usuarioId: req.autenticacion?.usuarioId,
      accion: 'DESACTIVAR_AREA',
      tipoEntidad: 'Area',
      idEntidad: id,
      datosAnteriores: anterior,
      datosNuevos: { ...areaActualizada, objetivosCancelados, asignacionesCanceladas },
    }, tx);

    return { area: areaActualizada, objetivosCancelados, asignacionesCanceladas };
  });

  responder(res, resultado);
};
