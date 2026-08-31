import type { Prisma } from '../../generated/prisma/client';
import type { PrismaTransaction } from '../../db';

import { generarUuid } from '../../utils/crypto';
import { registrarAuditoria } from '../registros_auditoria/helper';
import type { EstructuraFormularioEntrada } from './zod';

const incluirEstructuraRevision = {
  secciones: {
    orderBy: { orden: 'asc' as const },
    include: {
      preguntas: {
        orderBy: { orden: 'asc' as const },
      },
    },
  },
};

export const includeRevisionFormularioConEstructura = incluirEstructuraRevision;

type RevisionConEstructura = Prisma.VersionFormularioGetPayload<{
  include: typeof incluirEstructuraRevision;
}>;

type FormularioConRevisiones = Prisma.FormularioGetPayload<{
  include: {
    versiones: {
      include: typeof incluirEstructuraRevision;
    };
  };
}>;

const textoONull = (valor?: string | null) => {
  const limpio = valor?.trim();
  return limpio ? limpio : null;
};

const contarPreguntas = (revision: Pick<RevisionConEstructura, 'secciones'>) => (
  revision.secciones.reduce((total, seccion) => total + seccion.preguntas.length, 0)
);

export const mapearRevisionFormulario = (
  revision: RevisionConEstructura,
  actual = revision.activa,
) => ({
  id: revision.id,
  actual,
  creadoEn: revision.creadoEn,
  actualizadoEn: revision.actualizadoEn,
  totalSecciones: revision.secciones.length,
  totalPreguntas: contarPreguntas(revision),
  secciones: revision.secciones.map((seccion) => ({
    id: seccion.id,
    claveEstable: seccion.claveEstable,
    nombre: seccion.nombre,
    objetivo: seccion.objetivo,
    imagen: null,
    orden: seccion.orden,
    preguntas: seccion.preguntas.map((pregunta) => ({
      id: pregunta.id,
      claveEstable: pregunta.claveEstable,
      texto: pregunta.texto,
      orden: pregunta.orden,
    })),
  })),
});

export const mapearFormularioDetalle = (formulario: FormularioConRevisiones) => {
  const revisiones = [...formulario.versiones].sort((a, b) => (
    Number(b.activa) - Number(a.activa)
    || b.actualizadoEn.getTime() - a.actualizadoEn.getTime()
    || b.id - a.id
  ));
  const actual = revisiones.find((revision) => revision.activa) ?? revisiones[0] ?? null;

  return {
    id: formulario.id,
    nombre: formulario.nombre,
    descripcion: formulario.descripcion,
    alcance: formulario.alcance,
    activo: formulario.activo,
    creadoEn: formulario.creadoEn,
    actualizadoEn: formulario.actualizadoEn,
    actual: actual ? mapearRevisionFormulario(actual, true) : null,
    historial: revisiones.map((revision) => {
      const resumen = mapearRevisionFormulario(revision, actual?.id === revision.id);
      return {
        id: resumen.id,
        actual: resumen.actual,
        creadoEn: resumen.creadoEn,
        actualizadoEn: resumen.actualizadoEn,
        totalSecciones: resumen.totalSecciones,
        totalPreguntas: resumen.totalPreguntas,
      };
    }),
  };
};

const normalizarEstructuraBase = (secciones: EstructuraFormularioEntrada['secciones']) => (
  [...secciones]
    .sort((a, b) => a.orden - b.orden)
    .map((seccion) => ({
      claveEstable: seccion.claveEstable,
      nombre: seccion.nombre.trim(),
      objetivo: textoONull(seccion.objetivo),
      imagenPublicId: textoONull(seccion.imagenPublicId),
      imagenAlt: textoONull(seccion.imagenAlt),
      orden: seccion.orden,
      preguntas: [...seccion.preguntas]
        .sort((a, b) => a.orden - b.orden)
        .map((pregunta) => ({
          claveEstable: pregunta.claveEstable,
          texto: pregunta.texto.trim(),
          orden: pregunta.orden,
        })),
    }))
);

const normalizarRevisionBase = (revision: RevisionConEstructura) => (
  normalizarEstructuraBase(revision.secciones.map((seccion) => ({
    claveEstable: seccion.claveEstable,
    nombre: seccion.nombre,
    objetivo: seccion.objetivo,
    orden: seccion.orden,
    preguntas: seccion.preguntas.map((pregunta) => ({
      claveEstable: pregunta.claveEstable,
      texto: pregunta.texto,
      orden: pregunta.orden,
    })),
  })))
);

// Estructuras son idénticas si coinciden secciones, preguntas, orden y textos
export const estructurasFormularioIguales = (
  revision: RevisionConEstructura,
  secciones: EstructuraFormularioEntrada['secciones'],
) => JSON.stringify(normalizarRevisionBase(revision)) === JSON.stringify(normalizarEstructuraBase(secciones));

// Cambio estructural: difiere cantidad de preguntas/secciones, orden, o clavesEstables de las preguntas/secciones
export const esCambioEstructural = (
  revision: RevisionConEstructura,
  seccionesEntrada: EstructuraFormularioEntrada['secciones'],
) => {
  const actualNorm = normalizarRevisionBase(revision);
  const entradaNorm = normalizarEstructuraBase(seccionesEntrada);

  if (actualNorm.length !== entradaNorm.length) return true;

  for (let i = 0; i < actualNorm.length; i++) {
    const secA = actualNorm[i];
    const secE = entradaNorm[i];
    if (secA.orden !== secE.orden) return true;
    if (secA.claveEstable && secE.claveEstable && secA.claveEstable !== secE.claveEstable) return true;
    if (secA.preguntas.length !== secE.preguntas.length) return true;

    for (let j = 0; j < secA.preguntas.length; j++) {
      const pA = secA.preguntas[j];
      const pE = secE.preguntas[j];
      if (pA.orden !== pE.orden) return true;
      if (pA.claveEstable && pE.claveEstable && pA.claveEstable !== pE.claveEstable) return true;
    }
  }

  return false;
};

export const crearRevisionFormularioInterna = async (
  tx: PrismaTransaction,
  formularioId: number,
  secciones: EstructuraFormularioEntrada['secciones'],
  usuarioId?: number,
) => {
  const formulario = await tx.formulario.findUniqueOrThrow({
    where: { id: formularioId },
    include: {
      versiones: {
        orderBy: { numeroVersion: 'desc' },
        include: incluirEstructuraRevision,
      },
    },
  });

  const revisionActual = formulario.versiones.find((revision) => revision.activa) ?? formulario.versiones[0] ?? null;

  if (revisionActual && estructurasFormularioIguales(revisionActual, secciones)) {
    return { revision: revisionActual, creada: false, tipoCambio: 'SIN_CAMBIOS', mensaje: 'No hay cambios en el formulario.' };
  }

  // 1. REGLA 1: CORRECCIÓN EDITORIAL (sin cambio estructural)
  if (revisionActual && !esCambioEstructural(revisionActual, secciones)) {
    // Actualizar in-place textos de secciones y preguntas en TODAS las versiones del mismo formulario que compartan la misma claveEstable
    for (const secEntrada of secciones) {
      if (secEntrada.claveEstable) {
        await tx.seccionFormulario.updateMany({
          where: {
            claveEstable: secEntrada.claveEstable,
            versionFormulario: { formularioId },
          },
          data: {
            nombre: secEntrada.nombre.trim(),
            objetivo: textoONull(secEntrada.objetivo),
          },
        });
      }

      for (const pregEntrada of secEntrada.preguntas) {
        if (pregEntrada.claveEstable) {
          await tx.preguntaFormulario.updateMany({
            where: {
              claveEstable: pregEntrada.claveEstable,
              seccionFormulario: {
                versionFormulario: { formularioId },
              },
            },
            data: {
              texto: pregEntrada.texto.trim(),
            },
          });
        }
      }
    }

    const revisionActualizada = await tx.versionFormulario.findUniqueOrThrow({
      where: { id: revisionActual.id },
      include: incluirEstructuraRevision,
    });

    await registrarAuditoria({
      usuarioId,
      accion: 'ACTUALIZAR_TEXTO_FORMULARIO',
      tipoEntidad: 'VersionFormulario',
      idEntidad: revisionActualizada.id,
      datosAnteriores: revisionActual,
      datosNuevos: revisionActualizada,
    }, tx);

    return {
      revision: revisionActualizada,
      creada: false,
      tipoCambio: 'EDITORIAL',
      mensaje: 'Corrección editorial guardada correctamente sobre la versión actual.',
    };
  }

  // 2. REGLA 3, 4, 5: CAMBIO ESTRUCTURAL Y CONGELAMIENTO MENSUAL
  const ahora = new Date();
  const anioActual = ahora.getFullYear();
  const mesActual = ahora.getMonth() + 1;

  // Verificar si hay envíos en el formulario durante el año/mes actual
  const enviosEnMesActual = await tx.envioAuditoria.count({
    where: {
      objetivoAuditoria: {
        anio: anioActual,
        mes: mesActual,
        versionFormulario: {
          formularioId,
        },
      },
    },
  });

  const mesCongelado = enviosEnMesActual > 0;

  // Crear la nueva versión
  await tx.versionFormulario.updateMany({
    where: { formularioId },
    data: { activa: false },
  });

  const creada = await tx.versionFormulario.create({
    data: {
      formularioId,
      numeroVersion: (formulario.versiones[0]?.numeroVersion ?? 0) + 1,
      activa: true,
      creadoPorId: usuarioId ?? formulario.creadoPorId,
      secciones: {
        create: secciones.map((seccion) => ({
          claveEstable: seccion.claveEstable ?? generarUuid(),
          nombre: seccion.nombre.trim(),
          objetivo: textoONull(seccion.objetivo),
          imagenPublicId: textoONull(seccion.imagenPublicId),
          imagenAlt: textoONull(seccion.imagenAlt),
          orden: seccion.orden,
          preguntas: {
            create: seccion.preguntas.map((pregunta) => ({
              claveEstable: pregunta.claveEstable ?? generarUuid(),
              texto: pregunta.texto.trim(),
              orden: pregunta.orden,
            })),
          },
        })),
      },
    },
    include: incluirEstructuraRevision,
  });

  // Re-alinear ObjetivoAuditoria
  let anioDestino = anioActual;
  let mesDestino = mesActual;

  if (mesCongelado) {
    // Si el mes actual está congelado (tiene respuestas), la nueva versión aplica a partir del siguiente mes
    if (mesActual === 12) {
      anioDestino = anioActual + 1;
      mesDestino = 1;
    } else {
      mesDestino = mesActual + 1;
    }
  }

  // Actualizar ObjetivoAuditoria sin envíos asociados para el mesDestino (o mesActual si no hay envíos)
  await tx.objetivoAuditoria.updateMany({
    where: {
      anio: anioDestino,
      mes: mesDestino,
      envioResultadoId: null,
      enviosAuditoria: {
        none: {},
      },
      versionFormulario: {
        formularioId,
      },
    },
    data: {
      versionFormularioId: creada.id,
    },
  });

  await registrarAuditoria({
    usuarioId,
    accion: 'CREAR_REVISION_FORMULARIO',
    tipoEntidad: 'VersionFormulario',
    idEntidad: creada.id,
    datosAnteriores: revisionActual,
    datosNuevos: creada,
  }, tx);

  const mensaje = mesCongelado
    ? `Cambio estructural guardado. Los cambios aplicarán a partir del próximo mes (${mesDestino}/${anioDestino}) porque el mes actual ya tiene auditorías respondidas.`
    : 'Cambio estructural guardado y aplicado al periodo actual.';

  return {
    revision: creada,
    creada: true,
    tipoCambio: 'ESTRUCTURAL',
    aplicadoMesSiguiente: mesCongelado,
    mensaje,
  };
};
