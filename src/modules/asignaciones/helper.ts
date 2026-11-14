import type { PrismaTransaction } from '../../db';
import {
  AlcanceFormulario,
  EstadoAsignacionAuditoria,
  type RolUsuario,
  TipoArea,
} from '../../generated/prisma/enums';
import { conflicto, prohibido, solicitudInvalida } from '../../utils/errores';
import { puedeAdministrar5S, puedeEjecutarAuditoria } from '../../utils/permisos';

export const obtenerAlcanceFormularioPorTipoArea = (tipoArea: TipoArea): AlcanceFormulario => (
  tipoArea === TipoArea.ADMINISTRATIVA
    ? AlcanceFormulario.ADMINISTRATIVO
    : AlcanceFormulario.OPERATIVO
);

export const obtenerVersionFormularioActivaPorTipoArea = async (
  tx: PrismaTransaction,
  tipoArea: TipoArea,
) => {
  const alcance = obtenerAlcanceFormularioPorTipoArea(tipoArea);

  if (tx.formulario?.findMany) {
    const formulariosActivos = await tx.formulario.findMany({
      where: { activo: true, alcance },
      select: { id: true, slug: true, nombre: true },
    });

    if (formulariosActivos.length === 0) {
      throw conflicto(`No existe formulario activo para áreas de tipo ${tipoArea}`);
    }
    if (formulariosActivos.length > 1) {
      throw conflicto(
        `Configuración ambigua de formularios: existen ${formulariosActivos.length} formularios activos para el alcance ${alcance}`,
      );
    }
  }

  const versiones = await tx.versionFormulario.findMany({
    where: {
      formulario: {
        activo: true,
        alcance: { in: [alcance] },
      },
    },
    include: {
      formulario: true,
      secciones: {
        orderBy: { orden: 'asc' as const },
        include: { preguntas: { orderBy: { orden: 'asc' as const } } },
      },
    },
    orderBy: { numeroVersion: 'desc' as const },
  });

  const versionesActivas = versiones.filter(
    (v) => v.activa && v.formulario?.alcance === alcance && v.formulario?.activo !== false,
  );

  const formulariosDistintos = new Set(versionesActivas.map((v) => v.formularioId));
  if (formulariosDistintos.size > 1) {
    throw conflicto(
      `Configuración ambigua de formularios: existen múltiples formularios activos para el alcance ${alcance}`,
    );
  }

  if (versionesActivas.length === 0) {
    throw conflicto(`No existe versión activa de formulario para áreas de tipo ${tipoArea}`);
  }

  if (versionesActivas.length > 1) {
    throw conflicto(
      `Configuración ambigua de formularios: existen ${versionesActivas.length} versiones activas para el alcance ${alcance}`,
    );
  }

  return versionesActivas[0];
};

export const esObjetivoElegibleParaSincronizarFormulario = (objetivo: {
  canceladoEn?: Date | null;
  envioResultadoId?: number | null;
  enviosAuditoria?: Array<{ id: number }>;
  asignacionesAuditoria?: Array<{
    estado: EstadoAsignacionAuditoria | string;
    iniciadoEn?: Date | null;
    completadoEn?: Date | null;
  }>;
}): boolean => {
  if (objetivo.canceladoEn !== null && objetivo.canceladoEn !== undefined) return false;
  if (objetivo.envioResultadoId !== null && objetivo.envioResultadoId !== undefined) return false;
  if ((objetivo.enviosAuditoria?.length ?? 0) > 0) return false;

  const tieneAsignacionIniciadaOCompletada = (objetivo.asignacionesAuditoria ?? []).some(
    (asig) =>
      asig.estado === EstadoAsignacionAuditoria.COMPLETADA
      || asig.estado === EstadoAsignacionAuditoria.EN_PROCESO
      || (asig.iniciadoEn !== null && asig.iniciadoEn !== undefined)
      || (asig.completadoEn !== null && asig.completadoEn !== undefined),
  );

  return !tieneAsignacionIniciadaOCompletada;
};

export const sincronizarObjetivosPendientesDeArea = async (
  tx: PrismaTransaction,
  area: { id: number; codigo: string; nombre: string; tipo: TipoArea },
) => {
  const versionActiva = await obtenerVersionFormularioActivaPorTipoArea(tx, area.tipo);

  const objetivosArea = await tx.objetivoAuditoria.findMany({
    where: {
      areaId: area.id,
      canceladoEn: null,
      envioResultadoId: null,
    },
    include: {
      enviosAuditoria: { select: { id: true } },
      asignacionesAuditoria: {
        select: {
          id: true,
          estado: true,
          iniciadoEn: true,
          completadoEn: true,
        },
      },
    },
    orderBy: [{ anio: 'asc' }, { mes: 'asc' }, { periodo: 'asc' }],
  });

  const candidatos = objetivosArea.filter(
    (obj) =>
      esObjetivoElegibleParaSincronizarFormulario(obj)
      && (
        obj.versionFormularioId !== versionActiva.id
        || obj.tipoAreaSnapshot !== area.tipo
        || obj.codigoAreaSnapshot !== area.codigo
        || obj.nombreAreaSnapshot !== area.nombre
      ),
  );

  const idsActualizar = candidatos.map((c) => c.id);
  let actualizadosCount = 0;

  if (idsActualizar.length > 0) {
    if (tx.objetivoAuditoria.updateMany) {
      const res = await tx.objetivoAuditoria.updateMany({
        where: {
          id: { in: idsActualizar },
          areaId: area.id,
          canceladoEn: null,
          envioResultadoId: null,
          enviosAuditoria: { none: {} },
          asignacionesAuditoria: {
            none: {
              OR: [
                { estado: EstadoAsignacionAuditoria.COMPLETADA },
                { estado: EstadoAsignacionAuditoria.EN_PROCESO },
                { iniciadoEn: { not: null } },
                { completadoEn: { not: null } },
              ],
            },
          },
        },
        data: {
          versionFormularioId: versionActiva.id,
          tipoAreaSnapshot: area.tipo,
          codigoAreaSnapshot: area.codigo,
          nombreAreaSnapshot: area.nombre,
        },
      });
      actualizadosCount = res.count;
    } else if (tx.objetivoAuditoria.update) {
      for (const id of idsActualizar) {
        await tx.objetivoAuditoria.update({
          where: { id },
          data: {
            versionFormularioId: versionActiva.id,
            tipoAreaSnapshot: area.tipo,
            codigoAreaSnapshot: area.codigo,
            nombreAreaSnapshot: area.nombre,
          },
        });
        actualizadosCount += 1;
      }
    }
  }

  return {
    versionFormularioId: versionActiva.id,
    formularioId: versionActiva.formularioId,
    objetivosActualizados: actualizadosCount,
    objetivosIds: idsActualizar,
  };
};

export const reconciliarObjetivoPendienteConArea = async (
  tx: PrismaTransaction,
  objetivo: {
    id: number;
    versionFormularioId: number;
    tipoAreaSnapshot: TipoArea;
    codigoAreaSnapshot: string;
    nombreAreaSnapshot: string;
    canceladoEn?: Date | null;
    envioResultadoId?: number | null;
    versionFormulario?: unknown;
  },
  area: { id: number; codigo: string; nombre: string; tipo: TipoArea },
) => {
  const versionActiva = await obtenerVersionFormularioActivaPorTipoArea(tx, area.tipo);

  if (objetivo.envioResultadoId || objetivo.canceladoEn) {
    return { reconciliado: false, versionFormulario: objetivo.versionFormulario as typeof versionActiva };
  }

  const requiereCambio =
    objetivo.versionFormularioId !== versionActiva.id
    || objetivo.tipoAreaSnapshot !== area.tipo
    || objetivo.codigoAreaSnapshot !== area.codigo
    || objetivo.nombreAreaSnapshot !== area.nombre;

  if (!requiereCambio) {
    return { reconciliado: false, versionFormulario: versionActiva };
  }

  let actualizado = false;
  if (tx.objetivoAuditoria.updateMany) {
    const res = await tx.objetivoAuditoria.updateMany({
      where: {
        id: objetivo.id,
        canceladoEn: null,
        envioResultadoId: null,
        enviosAuditoria: { none: {} },
        asignacionesAuditoria: {
          none: {
            OR: [
              { estado: EstadoAsignacionAuditoria.COMPLETADA },
              { estado: EstadoAsignacionAuditoria.EN_PROCESO },
              { iniciadoEn: { not: null } },
              { completadoEn: { not: null } },
            ],
          },
        },
      },
      data: {
        versionFormularioId: versionActiva.id,
        tipoAreaSnapshot: area.tipo,
        codigoAreaSnapshot: area.codigo,
        nombreAreaSnapshot: area.nombre,
      },
    });
    actualizado = res.count > 0;
  }

  if (actualizado) {
    objetivo.versionFormularioId = versionActiva.id;
    objetivo.tipoAreaSnapshot = area.tipo;
    objetivo.codigoAreaSnapshot = area.codigo;
    objetivo.nombreAreaSnapshot = area.nombre;
    objetivo.versionFormulario = versionActiva;
    return { reconciliado: true, versionFormulario: versionActiva };
  }

  return {
    reconciliado: false,
    versionFormulario: (objetivo.versionFormulario as typeof versionActiva) ?? versionActiva,
  };
};

export const validarAuditorAsignable = async (
  tx: PrismaTransaction,
  auditorId: number,
  objetivoAuditoriaId: number,
) => {
  const [auditor, objetivo] = await Promise.all([
    tx.usuario.findUniqueOrThrow({
      where: { id: auditorId },
      select: { id: true, rol: true, activo: true, nombre: true, puedeSerAsignadoAuditoria: true },
    }),
    tx.objetivoAuditoria.findUniqueOrThrow({
      where: { id: objetivoAuditoriaId },
      select: { id: true, areaId: true, nombreAreaSnapshot: true },
    }),
  ]);

  if (!auditor.activo) throw solicitudInvalida('El auditor seleccionado no esta activo');
  if (auditor.puedeSerAsignadoAuditoria === false) {
    throw solicitudInvalida('El usuario seleccionado no está habilitado para ser asignado a auditorías');
  }
  if (!puedeEjecutarAuditoria(auditor.rol)) {
    throw prohibido('El usuario seleccionado no puede realizar auditorias');
  }

  const perteneceAlArea = await tx.usuarioArea.findFirst({
    where: {
      usuarioId: auditorId,
      areaId: objetivo.areaId,
    },
    select: { id: true },
  });

  if (perteneceAlArea) {
    throw solicitudInvalida('El auditor no puede auditar su propia area');
  }

  return { auditor, objetivo };
};

export const puedeUsarAsignacionEjecutable = (
  autenticacion: { usuarioId: number; rol: RolUsuario } | undefined,
  auditorId: number,
) => Boolean(
  autenticacion
    && (puedeAdministrar5S(autenticacion.rol) || autenticacion.usuarioId === auditorId),
);

export const bloquearObjetivoAuditoria = async (tx: PrismaTransaction, objetivoId: number) => {
  const runner = tx as unknown as { $executeRaw: (query: TemplateStringsArray, ...values: unknown[]) => Promise<unknown> };
  await runner.$executeRaw`SELECT id FROM objetivos_auditoria WHERE id = ${objetivoId} FOR UPDATE`;
};
