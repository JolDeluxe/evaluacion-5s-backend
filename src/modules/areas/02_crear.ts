import type { Request, Response } from 'express';
import { solicitudInvalida } from '../../utils/errores';
import { responderCreado } from '../../utils/respuesta';
import { transaccionSerializable } from '../../utils/transaccion';
import { asegurarProgramacionMensual, auditableDesdeParaInicio, guardarAsignacionMensual } from '../asignaciones/programacion_mensual';
import { registrarAuditoria } from '../registros_auditoria/helper';
import { generarCodigoVerificacionUnico } from './codigo_verificacion';
import { esquemaCrearArea } from './zod';

export const crearArea = async (req: Request, res: Response) => {
  const body = esquemaCrearArea.parse(req.body);
  if (body.inicioProgramaAuditoria === 'ESTE_MES' && !body.auditorMensualId) {
    throw solicitudInvalida('Para incluir esta area en el mes actual debes seleccionar un auditor');
  }
  if (body.auditorMensualId && body.responsablesIds.includes(body.auditorMensualId)) {
    throw solicitudInvalida('El auditor no puede auditar su propia area');
  }

  const area = await transaccionSerializable(async (tx) => {
    const ahora = new Date();
    const creado = await tx.area.create({
      data: {
        codigo: body.codigo.trim().toUpperCase(),
        nombre: body.nombre.trim(),
        tipo: body.tipo,
        auditableDesde: auditableDesdeParaInicio(body.inicioProgramaAuditoria, ahora),
        codigoVerificacion: await generarCodigoVerificacionUnico(tx),
        usuariosArea: {
          createMany: {
            data: [...new Set(body.responsablesIds)].map((usuarioId) => ({ usuarioId })),
            skipDuplicates: true,
          },
        },
      },
    });
    if (body.inicioProgramaAuditoria === 'ESTE_MES' && body.auditorMensualId) {
      await asegurarProgramacionMensual(tx, ahora.getFullYear(), ahora.getMonth() + 1, req.autenticacion?.usuarioId ?? 1);
      await guardarAsignacionMensual(tx, {
        areaId: creado.id,
        anio: ahora.getFullYear(),
        mes: ahora.getMonth() + 1,
        auditorMensualId: body.auditorMensualId,
        asignadoPorId: req.autenticacion?.usuarioId ?? 1,
      });
    }
    await registrarAuditoria({ usuarioId: req.autenticacion?.usuarioId, accion: 'CREAR_AREA', tipoEntidad: 'Area', idEntidad: creado.id, datosNuevos: creado }, tx);
    return creado;
  });
  responderCreado(res, { area });
};
