import type { Request, Response } from 'express';
import type { PrismaTransaction } from '../../db';
import { EstadoAsignacionAuditoria } from '../../generated/prisma/enums';
import { conflicto } from '../../utils/errores';
import { calcularCierreConGracia, sumarDiasHabiles, tieneEnvioResultadoValido } from '../../utils/periodos';
import { responder } from '../../utils/respuesta';
import { transaccionSerializable } from '../../utils/transaccion';
import { registrarAuditoria } from '../registros_auditoria/helper';
import { esquemaId, esquemaReabrirAsignacion } from './zod';

const asignacionActiva = <T extends { estado: EstadoAsignacionAuditoria }>(asignaciones: T[]) => (
  asignaciones.find((asignacion) => asignacion.estado !== EstadoAsignacionAuditoria.CANCELADA) ?? null
);

export const reabrirAsignacion = async (req: Request, res: Response) => {
  const { id } = esquemaId.parse(req.params);
  const body = esquemaReabrirAsignacion.parse(req.body);
  const usuarioId = req.autenticacion?.usuarioId ?? 1;

  const asignacion = await transaccionSerializable(async (tx) => {
    return reabrirAsignacionEnTransaccion(tx, id, body, usuarioId);
  });

  responder(res, { asignacion });
};

export const reabrirAsignacionEnTransaccion = async (
  tx: PrismaTransaction,
  id: number,
  body: { motivo: string; reabiertaHasta?: Date; auditorMensualId?: number },
  usuarioId: number,
) => {
  const actual = await tx.asignacionAuditoria.findUniqueOrThrow({
    where: { id },
    include: {
      objetivoAuditoria: {
        include: {
          envioResultado: true,
          enviosAuditoria: true,
        },
      },
    },
  });

  if (tieneEnvioResultadoValido(actual.objetivoAuditoria)) {
    throw conflicto('La auditoria ya fue realizada');
  }

  const ahora = new Date();
  if (ahora <= calcularCierreConGracia(actual.objetivoAuditoria.terminaEn)) {
    throw conflicto('El periodo todavia esta dentro de su ventana normal o gracia');
  }

  const objetivosVencidos = await tx.objetivoAuditoria.findMany({
    where: {
      areaId: actual.objetivoAuditoria.areaId,
      terminaEn: { lt: ahora },
    },
    include: {
      envioResultado: true,
      enviosAuditoria: true,
      asignacionesAuditoria: { orderBy: { actualizadoEn: 'desc' } },
    },
  });

  const recuperables = objetivosVencidos
    .filter((objetivo) => !tieneEnvioResultadoValido(objetivo))
    .filter((objetivo) => ahora > calcularCierreConGracia(objetivo.terminaEn))
    .sort((a, b) => (
      b.iniciaEn.getTime() - a.iniciaEn.getTime()
      || b.periodo - a.periodo
    ));

  const masReciente = recuperables[0] ?? null;
  if (!masReciente || masReciente.id !== actual.objetivoAuditoriaId) {
    throw conflicto('Solo se puede reabrir el periodo vencido mas reciente de esta area');
  }

  const vigente = asignacionActiva(masReciente.asignacionesAuditoria);
  if (!vigente || vigente.id !== actual.id) {
    throw conflicto('La asignacion ya no es la vigente para este periodo');
  }

  // Si se proporciona un nuevo auditor mensual, aplicar la asignación mensual primero (actualizando AsignacionMensual y otros periodos no bloqueados)
  let nuevoAuditorId = actual.auditorId;
  if (body.auditorMensualId) {
    const { guardarAsignacionMensual } = await import('./programacion_mensual');
    await guardarAsignacionMensual(tx, {
      areaId: actual.objetivoAuditoria.areaId,
      anio: actual.objetivoAuditoria.anio,
      mes: actual.objetivoAuditoria.mes,
      auditorMensualId: body.auditorMensualId,
      asignadoPorId: usuarioId,
    });
    nuevoAuditorId = body.auditorMensualId;
  }

  const reabiertaHasta = body.reabiertaHasta ?? sumarDiasHabiles(ahora, 5);
  if (reabiertaHasta <= ahora) throw conflicto('La fecha de reapertura debe ser futura');

  const actualizada = await tx.asignacionAuditoria.update({
    where: { id },
    data: {
      estado: EstadoAsignacionAuditoria.PENDIENTE,
      auditorId: nuevoAuditorId,
      reabiertaHasta,
      reabiertaEn: ahora,
      reabiertaPorId: usuarioId,
      motivoReapertura: body.motivo,
    },
    include: { objetivoAuditoria: true, auditor: true },
  });

  await registrarAuditoria({
    usuarioId,
    accion: 'REABRIR_ASIGNACION_AUDITORIA',
    tipoEntidad: 'AsignacionAuditoria',
    idEntidad: id,
    datosAnteriores: actual,
    datosNuevos: actualizada,
  }, tx);

  return actualizada;
};
