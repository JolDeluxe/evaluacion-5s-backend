import type { Request, Response } from 'express';
import { prisma } from '../../db';
import { noEncontrado } from '../../utils/errores';
import { responder } from '../../utils/respuesta';
import { obtenerEjecutablesUsuario } from '../asignaciones/01_listar';
import { obtenerObjetivoRealizableMasAntiguo } from '../../utils/objetivos_periodo';

export const normalizarCodigoQr = (codigo: string) => codigo.trim().toUpperCase().replace(/[\s-]/g, '');

export const resolverCodigoQr = async (req: Request, res: Response) => {
  const rawCodigo = String(req.params.codigo ?? '');
  const codigoBuscado = normalizarCodigoQr(rawCodigo);

  if (!codigoBuscado) {
    throw noEncontrado('Código de área no válido');
  }

  // Buscar área cuyo codigoVerificacion (sin guiones/espacios) coincida
  const areas = await prisma.area.findMany({
    select: {
      id: true,
      codigo: true,
      nombre: true,
      tipo: true,
      activo: true,
      codigoVerificacion: true,
    },
  });

  const area = areas.find((a) => normalizarCodigoQr(a.codigoVerificacion) === codigoBuscado);

  if (!area) {
    throw noEncontrado('Código de área no válido');
  }

  if (!area.activo) {
    responder(res, {
      disponible: false,
      motivo: 'Esta área no está disponible para auditoría.',
      area: {
        id: area.id,
        nombre: area.nombre,
        tipo: area.tipo,
        activo: area.activo,
        codigoVerificacion: area.codigoVerificacion,
      },
      asignacionesDisponibles: [],
    });
    return;
  }

  const usuarioId = req.autenticacion?.usuarioId;

  if (usuarioId) {
    const ejecutables = await obtenerEjecutablesUsuario(prisma, usuarioId);
    const asignacionesArea = ejecutables.filter((asig) => asig.objetivoAuditoria.areaId === area.id);

    responder(res, {
      disponible: true,
      area: {
        id: area.id,
        nombre: area.nombre,
        tipo: area.tipo,
        activo: area.activo,
        codigoVerificacion: area.codigoVerificacion,
      },
      asignacionesDisponibles: asignacionesArea.map((asig) => ({
        id: asig.id,
        objetivoAuditoriaId: asig.objetivoAuditoriaId,
        anio: asig.objetivoAuditoria.anio,
        mes: asig.objetivoAuditoria.mes,
        periodo: asig.objetivoAuditoria.periodo,
        venceEn: asig.venceEn,
        infoPeriodo: asig.infoPeriodo,
        bloqueoPeriodoAnterior: asig.bloqueoPeriodoAnterior,
      })),
    });
    return;
  }

  // Usuario no autenticado (Invitado)
  const objetivo = await obtenerObjetivoRealizableMasAntiguo(prisma, area.id);

  responder(res, {
    disponible: !!objetivo,
    motivo: objetivo ? null : 'El área no tiene auditorías disponibles para el periodo actual.',
    area: {
      id: area.id,
      nombre: area.nombre,
      tipo: area.tipo,
      activo: area.activo,
      codigoVerificacion: area.codigoVerificacion,
    },
    asignacionesDisponibles: [],
  });
};
