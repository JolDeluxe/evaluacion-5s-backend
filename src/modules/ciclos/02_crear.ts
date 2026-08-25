import type { Request, Response } from 'express';
import { conflicto } from '../../utils/errores';
import { responderCreado } from '../../utils/respuesta';
import { transaccionSerializable } from '../../utils/transaccion';
import { registrarAuditoria } from '../registros_auditoria/helper';
import { esquemaCrearCiclo } from './zod';

export const crearCiclo = async (req: Request, res: Response) => {
  const body = esquemaCrearCiclo.parse(req.body);
  const ciclo = await transaccionSerializable(async (tx) => {
    const versiones = await tx.versionFormulario.findMany({
      where: { id: { in: body.formularios.map((formulario) => formulario.versionFormularioId) } },
    });
    if (versiones.length !== body.formularios.length || versiones.some((version) => !version.activa)) {
      throw conflicto('El ciclo solo puede usar versiones activas existentes');
    }
    const creado = await tx.cicloAuditoria.create({
      data: {
        anio: body.anio,
        mes: body.mes,
        numeroCorte: body.numeroCorte,
        nombre: body.nombre ?? null,
        iniciaEn: body.iniciaEn,
        terminaEn: body.terminaEn,
        creadoPorId: req.autenticacion?.usuarioId ?? 1,
        formulariosCiclo: { create: body.formularios },
      },
      include: { formulariosCiclo: true },
    });
    await registrarAuditoria({ usuarioId: req.autenticacion?.usuarioId, accion: 'CREAR_CICLO', tipoEntidad: 'CicloAuditoria', idEntidad: creado.id, datosNuevos: creado }, tx);
    return creado;
  });
  responderCreado(res, { ciclo });
};
