import type { Request, Response } from 'express';
import { z } from 'zod';
import type { PrismaTransaction } from '../../db';
import { prisma } from '../../db';
import { Prisma } from '../../generated/prisma/client';
import { EstadoAsignacionAuditoria } from '../../generated/prisma/enums';
import { obtenerPaginacion } from '../../utils/paginacion';
import { puedeAdministrar5S } from '../../utils/permisos';
import { responderLista } from '../../utils/respuesta';
import { calcularCierreConGracia, obtenerPeriodoInmediatamenteAnterior, obtenerAsignacionesBloqueadorasPeriodoAnterior, construirPayloadBloqueoPeriodoAnterior } from '../../utils/periodos';

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

const mismanoche = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
const mismoDia = (d1: Date, d2: Date) => (
  d1.getFullYear() === d2.getFullYear()
  && d1.getMonth() === d2.getMonth()
  && d1.getDate() === d2.getDate()
);

export const obtenerEjecutablesUsuario = async (
  tx: PrismaTransaction,
  usuarioId: number,
  ahora = new Date(),
) => {
  const rawAsignaciones = await tx.asignacionAuditoria.findMany({
    where: {
      auditorId: usuarioId,
      estado: { not: EstadoAsignacionAuditoria.CANCELADA },
      objetivoAuditoria: {
        iniciaEn: { lte: ahora },
      },
    },
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
    },
    orderBy: [
      { venceEn: 'asc' },
      { id: 'asc' },
    ],
  });

  const rawMapped = await Promise.all(
    rawAsignaciones.map(async (asig) => {
      const infoPeriodo = obtenerEstadoEjecucion(asig, ahora);
      const prev = obtenerPeriodoInmediatamenteAnterior(
        asig.objetivoAuditoria.anio,
        asig.objetivoAuditoria.mes,
        asig.objetivoAuditoria.periodo,
      );
      const bloqueadoras = await obtenerAsignacionesBloqueadorasPeriodoAnterior(
        tx,
        usuarioId,
        asig.objetivoAuditoria.anio,
        asig.objetivoAuditoria.mes,
        asig.objetivoAuditoria.periodo,
        ahora,
      );

      const bloqueoPeriodoAnterior = bloqueadoras.length > 0
        ? construirPayloadBloqueoPeriodoAnterior(prev, bloqueadoras, ahora)
        : null;

      return {
        ...asig,
        infoPeriodo,
        bloqueoPeriodoAnterior,
      };
    })
  );

  return rawMapped.filter((asig) => {
    if (asig.estado === EstadoAsignacionAuditoria.CANCELADA) return false;
    if (asig.objetivoAuditoria.iniciaEn > ahora) return false;
    return asig.infoPeriodo.realizable && asig.estado !== EstadoAsignacionAuditoria.COMPLETADA;
  });
};

export const obtenerEstadoEjecucion = (
  asig: {
    estado: EstadoAsignacionAuditoria;
    reabiertaHasta?: Date | string | null;
    completadoEn?: Date | string | null;
    objetivoAuditoria: {
      iniciaEn: Date | string;
      terminaEn: Date | string;
      envioResultado?: { verificadoEn?: Date | string | null } | null;
    };
  },
  ahora = new Date(),
) => {
  if (asig.estado === EstadoAsignacionAuditoria.CANCELADA) {
    return { status: 'CANCELADA', texto: 'Cancelada', color: 'gris', realizable: false };
  }

  const iniciaEn = new Date(asig.objetivoAuditoria.iniciaEn);
  const terminaEn = new Date(asig.objetivoAuditoria.terminaEn);
  const cierreGracia = calcularCierreConGracia(terminaEn);
  const reabiertaHasta = asig.reabiertaHasta ? new Date(asig.reabiertaHasta) : null;

  if (ahora < mismanoche(iniciaEn) && !mismoDia(ahora, iniciaEn) && ahora < iniciaEn) {
    return {
      status: 'AUN_NO_INICIA',
      texto: 'Aún no inicia',
      badgeTexto: 'Aún no inicia',
      color: 'gris',
      realizable: false,
    };
  }

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

  // 1. REABIERTA ADMINISTRATIVA
  if (reabiertaHasta && ahora <= mismanoche(reabiertaHasta)) {
    const esUltimoDiaReapertura = mismoDia(ahora, reabiertaHasta);
    if (esUltimoDiaReapertura) {
      return {
        status: 'REABIERTA',
        texto: 'ÚLTIMO DÍA PARA REALIZAR',
        badgeTexto: 'ÚLTIMO DÍA',
        color: 'rojo',
        realizable: true,
        reabiertaHasta,
      };
    }

    return {
      status: 'REABIERTA',
      texto: 'REABIERTA · VENCIDA',
      badgeTexto: 'REABIERTA · VENCIDA',
      color: 'rojo',
      realizable: true,
      reabiertaHasta,
    };
  }

  // 2. PERIODO NORMAL
  if (ahora <= mismanoche(terminaEn)) {
    const esUltimoDiaNormal = mismoDia(ahora, terminaEn);
    if (esUltimoDiaNormal) {
      return {
        status: 'PENDIENTE',
        texto: 'ÚLTIMO DÍA PARA REALIZAR',
        badgeTexto: 'ÚLTIMO DÍA',
        color: 'rojo',
        realizable: true,
      };
    }

    return {
      status: 'PENDIENTE',
      texto: 'Disponible',
      badgeTexto: 'Disponible',
      color: 'verde',
      realizable: true,
    };
  }

  // 3. VENCIDA PERO AÚN EJECUTABLE (VENTANA TARDÍA)
  if (ahora <= mismanoche(cierreGracia)) {
    const esUltimoDiaGracia = mismoDia(ahora, cierreGracia);
    if (esUltimoDiaGracia) {
      return {
        status: 'VENCIDA',
        texto: 'ÚLTIMO DÍA PARA REALIZAR',
        badgeTexto: 'ÚLTIMO DÍA',
        color: 'rojo',
        realizable: true,
      };
    }

    return {
      status: 'VENCIDA',
      texto: 'ATRASADA',
      badgeTexto: 'ATRASADA',
      color: 'rojo',
      realizable: true,
    };
  }

  // 4. CERRADA DEFINITIVAMENTE
  return {
    status: 'CERRADA',
    texto: '🔒 Periodo cerrado',
    badgeTexto: 'CERRADA',
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
        ...(query.tipoBandeja === 'EJECUTABLES' ? { iniciaEn: { lte: ahora } } : {}),
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
      const ejecutables = rawMapped.filter((asig) => {
        if (asig.estado === EstadoAsignacionAuditoria.CANCELADA) return false;
        if (asig.objetivoAuditoria.iniciaEn > ahora) return false;
        return asig.infoPeriodo.realizable;
      });

      return responderLista(res, ejecutables, { pagina: 1, limite: 100, total: ejecutables.length });
    } else {
      const historial = rawMapped.filter((asig) => {
        if (asig.estado === EstadoAsignacionAuditoria.CANCELADA) return false;
        // When filtering by a specific month, include all assignments (realized, pending, future, expired)
        if (query.anio && query.mes) return true;
        return (
          asig.estado === EstadoAsignacionAuditoria.COMPLETADA ||
          asig.estado === EstadoAsignacionAuditoria.VENCIDA ||
          !asig.infoPeriodo.realizable
        );
      });

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
