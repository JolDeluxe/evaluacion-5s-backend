import type { Request, Response } from 'express';
import { responder } from '../../utils/respuesta';
import { transaccionSerializable } from '../../utils/transaccion';
import {
  asegurarProgramacionMensual,
  guardarAsignacionMensual,
  obtenerVistaMensual,
  puedeAsegurarProgramacionMensual,
} from './programacion_mensual';
import { esquemaGuardarLoteAsignaciones } from './zod';

export const guardarLoteAsignacionesMensuales = async (req: Request, res: Response) => {
  const body = esquemaGuardarLoteAsignaciones.parse(req.body);
  const usuarioId = req.autenticacion?.usuarioId ?? 1;

  // 1. Asegurar programación mensual UNA SOLA VEZ para todo el mes si aplica
  if (puedeAsegurarProgramacionMensual(body.anio, body.mes)) {
    await transaccionSerializable(async (tx) => {
      await asegurarProgramacionMensual(tx, body.anio, body.mes, usuarioId);
    });
  }

  // 2. Orden determinista por areaId ASC para prevenir bloqueos cruzados
  const asignacionesOrdenadas = [...body.asignaciones].sort((a, b) => a.areaId - b.areaId);

  const guardadas: number[] = [];
  const fallidas: Array<{ areaId: number; motivo: string }> = [];

  // 3. Procesamiento secuencial con transacción aislada e independiente por área
  for (const item of asignacionesOrdenadas) {
    try {
      await transaccionSerializable(async (tx) => {
        return guardarAsignacionMensual(tx, {
          areaId: item.areaId,
          anio: body.anio,
          mes: body.mes,
          auditorMensualId: item.auditorMensualId,
          responsableCumplimientoId: item.responsableCumplimientoId,
          expectedAuditorId: item.expectedAuditorId,
          asignadoPorId: usuarioId,
        });
      });
      guardadas.push(item.areaId);
    } catch (err: unknown) {
      const motivo = err instanceof Error ? err.message : 'Error al guardar la asignación';
      fallidas.push({ areaId: item.areaId, motivo });
    }
  }

  // 4. Obtener la vista mensual consolidada una sola vez al final
  const vista = await transaccionSerializable(async (tx) => {
    return obtenerVistaMensual(tx, body.anio, body.mes);
  });

  responder(res, {
    guardadas,
    fallidas,
    totalProcesadas: asignacionesOrdenadas.length,
    vista,
  });
};
