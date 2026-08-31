import type { Request, Response } from 'express';
import { z } from 'zod';

import { prisma } from '../../db';
import { Prisma } from '../../generated/prisma/client';
import { EstadoAsignacionAuditoria } from '../../generated/prisma/enums';
import { obtenerPaginacion } from '../../utils/paginacion';
import { puedeAdministrar5S } from '../../utils/permisos';
import { responderLista } from '../../utils/respuesta';
import { calcularCierreConGracia } from '../../utils/periodos';

const esquemaQuery = z
  .object({
    estado: z.enum(EstadoAsignacionAuditoria).optional(),
    auditorId: z.coerce.number().int().positive().optional(),
    objetivoAuditoriaId: z.coerce.number().int().positive().optional(),
    tipoBandeja: z.enum(['EJECUTABLES', 'HISTORIAL']).optional(),
    anio: z.coerce.number().int().optional(),
    mes: z.coerce.number().int().optional(),
  })
  .passthrough();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const obtenerEstadoEjecucion = (asig: any, ahora = new Date()) => {
  if (asig.estado === EstadoAsignacionAuditoria.CANCELADA) {
    return { status: 'CANCELADA', texto: 'Cancelada', color: 'gris', realizable: false };
  }

  const terminaEn = new Date(asig.objetivoAuditoria.terminaEn);
  const cierreGracia = calcularCierreConGracia(terminaEn);

  if (asig.estado === EstadoAsignacionAuditoria.COMPLETADA) {
    const completadoEn = asig.completadoEn
      ? new Date(asig.completadoEn)
      : (asig.objetivoAuditoria.envioResultado?.verificadoEn
          ? new Date(asig.objetivoAuditoria.envioResultado.verificadoEn)
          : ahora);
    const aTiempo = completadoEn <= terminaEn;
    return {
      status: aTiempo ? 'REALIZADA_A_TIEMPO' : 'REALIZADA_CON_ATRASO',
      texto: aTiempo ? 'Realizada' : 'Realizada con atraso',
      color: 'verde',
      realizable: false,
    };
  }

  // Check reabierta
  if (asig.reabiertaHasta && ahora <= new Date(asig.reabiertaHasta)) {
    const diffTime = new Date(asig.reabiertaHasta).getTime() - ahora.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return {
      status: 'REABIERTA',
      texto: `Reabierta · Vence en ${diffDays} día${diffDays === 1 ? '' : 's'}`,
      color: 'ambar',
      realizable: true,
      diasRestantes: diffDays,
    };
  }

  // Pending
  if (ahora <= terminaEn) {
    const diffTime = terminaEn.getTime() - ahora.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    if (diffDays <= 1) {
      return {
        status: 'PENDIENTE',
        texto: diffDays === 0 ? 'Vence hoy' : 'Vence mañana',
        color: 'rojo',
        realizable: true,
        diasRestantes: diffDays,
      };
    }
    if (diffDays <= 4) {
      return {
        status: 'PENDIENTE',
        texto: `Vence pronto · ${diffDays} días restantes`,
        color: 'ambar',
        realizable: true,
        diasRestantes: diffDays,
      };
    }
    return {
      status: 'PENDIENTE',
      texto: `En tiempo · ${diffDays} días restantes`,
      color: 'verde',
      realizable: true,
      diasRestantes: diffDays,
    };
  }

  // Grace period
  if (ahora <= cierreGracia) {
    const diffTime = cierreGracia.getTime() - ahora.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return {
      status: 'EN_GRACIA',
      texto: `Periodo vencido · disponible gracia (${diffDays}d)`,
      color: 'ambar',
      realizable: true,
      diasRestantes: diffDays,
    };
  }

  // Closed
  return {
    status: 'CERRADA',
    texto: '🔒 Periodo cerrado',
    color: 'gris',
    realizable: false,
  };
};

export const listarAsignaciones = async (
  req: Request,
  res: Response,
) => {
  const { pagina, limite, saltar } = obtenerPaginacion(req.query);
  const query = esquemaQuery.parse(req.query);
  const ahora = new Date();

  const esAdmin = puedeAdministrar5S(req.autenticacion?.rol);

  // Filter tray lists (EJECUTABLES or HISTORIAL) for the logged-in auditor
  if (query.tipoBandeja) {
    const auditorId = req.autenticacion?.usuarioId ?? 0;

    const where: Prisma.AsignacionAuditoriaWhereInput = {
      auditorId,
      objetivoAuditoria: {
        iniciaEn: { lte: ahora },
        ...(query.anio ? { anio: query.anio } : {}),
        ...(query.mes ? { mes: query.mes } : {}),
      }
    };

    const rawAsignaciones = await prisma.asignacionAuditoria.findMany({
      where,
      include: {
        auditor: {
          select: {
            id: true,
            nombre: true,
            nombreUsuario: true,
          },
        },
        objetivoAuditoria: {
          include: {
            area: {
              select: {
                id: true,
                codigo: true,
                nombre: true,
                tipo: true,
              },
            },
            envioResultado: true,
            enviosAuditoria: true,
          },
        },
        enlacesInvitado: {
          where: {
            revocadoEn: null,
            usadoEn: null,
            expiraEn: { gt: ahora },
          },
          select: {
            id: true,
            expiraEn: true,
            creadoEn: true,
          },
          orderBy: { creadoEn: 'desc' },
          take: 1,
        },
      },
      orderBy: [
        { venceEn: 'asc' },
        { id: 'asc' },
      ],
    });

    // Map each assignment to calculate execution status on the backend
    const rawMapped = rawAsignaciones.map((asig) => {
      const infoPeriodo = obtenerEstadoEjecucion(asig, ahora);
      return {
        ...asig,
        infoPeriodo,
        invitacionActiva: asig.enlacesInvitado[0] ?? null,
      };
    });

    if (query.tipoBandeja === 'EJECUTABLES') {
      const periodoActivo = rawMapped
        .map((asig) => asig.objetivoAuditoria)
        .filter((objetivo) => objetivo.iniciaEn <= ahora)
        .sort((a, b) => b.iniciaEn.getTime() - a.iniciaEn.getTime())[0] ?? null;

      if (!periodoActivo) {
        return responderLista(res, [], { pagina: 1, limite: 100, total: 0 });
      }

      const ejecutables = rawMapped.filter((asig) => {
        if (asig.estado === EstadoAsignacionAuditoria.CANCELADA) return false;
        const objetivo = asig.objetivoAuditoria;
        const esDelPeriodoActivo = objetivo.anio === periodoActivo.anio
          && objetivo.mes === periodoActivo.mes
          && objetivo.periodo === periodoActivo.periodo;
        const esEjecutable = asig.infoPeriodo.realizable;
        return esDelPeriodoActivo || esEjecutable;
      });

      return responderLista(res, ejecutables, { pagina: 1, limite: 100, total: ejecutables.length });
    } else {
      const historial = rawMapped.filter((asig) =>
        asig.estado === EstadoAsignacionAuditoria.COMPLETADA ||
        asig.estado === EstadoAsignacionAuditoria.VENCIDA ||
        !asig.infoPeriodo.realizable
      );

      // Sort alphabetically by area name (A→Z)
      historial.sort((a, b) => {
        const nombreA = a.objetivoAuditoria.area?.nombre ?? '';
        const nombreB = b.objetivoAuditoria.area?.nombre ?? '';
        return nombreA.localeCompare(nombreB, 'es-MX');
      });

      // When filtering by a specific month, return all records without pagination
      if (query.anio && query.mes) {
        return responderLista(res, historial, { pagina: 1, limite: historial.length, total: historial.length });
      }

      const total = historial.length;
      const paginados = historial.slice(saltar, saltar + limite);

      return responderLista(res, paginados, {
        pagina,
        limite,
        total,
      });
    }
  }

  // Generic administrative behavior
  const genericWhere = {
    ...(query.estado ? { estado: query.estado } : {}),
    ...(esAdmin && query.auditorId ? { auditorId: query.auditorId } : {}),
    ...(!esAdmin ? { auditorId: req.autenticacion?.usuarioId ?? 0 } : {}),
    ...(query.objetivoAuditoriaId ? { objetivoAuditoriaId: query.objetivoAuditoriaId } : {}),
  };

  const [datos, total] = await prisma.$transaction([
    prisma.asignacionAuditoria.findMany({
      where: genericWhere,
      include: {
        auditor: {
          select: {
            id: true,
            nombre: true,
            nombreUsuario: true,
          },
        },
        objetivoAuditoria: {
          include: {
            area: {
              select: {
                id: true,
                codigo: true,
                nombre: true,
                tipo: true,
              },
            },
          },
        },
      },
      skip: saltar,
      take: limite,
      orderBy: [
        { venceEn: 'asc' },
        { id: 'asc' },
      ],
    }),
    prisma.asignacionAuditoria.count({
      where: genericWhere,
    }),
  ]);

  responderLista(res, datos, {
    pagina,
    limite,
    total,
  });
};
