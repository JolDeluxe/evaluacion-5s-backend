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

export function calcularDiferenciasEstructura(
  versionAnterior: RevisionConEstructura,
  versionNueva: RevisionConEstructura,
) {
  const preguntasAnteriores = new Map<string, { texto: string; orden: number; requiereHallazgo: boolean }>();
  for (const sec of versionAnterior.secciones) {
    for (const preg of sec.preguntas) {
      if (preg.claveEstable) {
        preguntasAnteriores.set(preg.claveEstable, {
          texto: preg.texto,
          orden: preg.orden,
          requiereHallazgo: preg.requiereHallazgo ?? true,
        });
      }
    }
  }

  const preguntasNuevas = new Map<string, { texto: string; orden: number; requiereHallazgo: boolean }>();
  for (const sec of versionNueva.secciones) {
    for (const preg of sec.preguntas) {
      if (preg.claveEstable) {
        preguntasNuevas.set(preg.claveEstable, {
          texto: preg.texto,
          orden: preg.orden,
          requiereHallazgo: preg.requiereHallazgo ?? true,
        });
      }
    }
  }

  let agregadas = 0;
  let retiradas = 0;
  let configuracionesModificadas = 0;
  let textosEditados = 0;

  for (const [clave, pregN] of preguntasNuevas) {
    const pregA = preguntasAnteriores.get(clave);
    if (!pregA) {
      agregadas++;
    } else {
      if (pregA.requiereHallazgo !== pregN.requiereHallazgo) {
        configuracionesModificadas++;
      }
      if (pregA.texto.trim() !== pregN.texto.trim()) {
        textosEditados++;
      }
    }
  }

  for (const [clave] of preguntasAnteriores) {
    if (!preguntasNuevas.has(clave)) {
      retiradas++;
    }
  }

  const seccionesAnteriores = new Set(versionAnterior.secciones.map((s) => s.claveEstable).filter(Boolean));
  const seccionesNuevas = new Set(versionNueva.secciones.map((s) => s.claveEstable).filter(Boolean));

  let seccionesAgregadas = 0;
  let seccionesRetiradas = 0;

  for (const clave of seccionesNuevas) {
    if (!seccionesAnteriores.has(clave)) seccionesAgregadas++;
  }
  for (const clave of seccionesAnteriores) {
    if (!seccionesNuevas.has(clave)) seccionesRetiradas++;
  }

  return {
    agregadas,
    retiradas,
    configuracionesModificadas,
    textosEditados,
    seccionesAgregadas,
    seccionesRetiradas,
  };
}

export function generarTextoDiferencias(diff: ReturnType<typeof calcularDiferenciasEstructura>) {
  const partes: string[] = [];

  if (diff.configuracionesModificadas > 0) {
    partes.push(`${diff.configuracionesModificadas} configuración${diff.configuracionesModificadas > 1 ? 'es' : ''} de pregunta${diff.configuracionesModificadas > 1 ? 's' : ''} modificada${diff.configuracionesModificadas > 1 ? 's' : ''}`);
  }
  if (diff.agregadas > 0) {
    partes.push(`${diff.agregadas} pregunta${diff.agregadas > 1 ? 's' : ''} agregada${diff.agregadas > 1 ? 's' : ''}`);
  }
  if (diff.retiradas > 0) {
    partes.push(`${diff.retiradas} pregunta${diff.retiradas > 1 ? 's' : ''} retirada${diff.retiradas > 1 ? 's' : ''}`);
  }
  if (diff.seccionesAgregadas > 0) {
    partes.push(`${diff.seccionesAgregadas} sección${diff.seccionesAgregadas > 1 ? 'es' : ''} agregada${diff.seccionesAgregadas > 1 ? 's' : ''}`);
  }
  if (diff.seccionesRetiradas > 0) {
    partes.push(`${diff.seccionesRetiradas} sección${diff.seccionesRetiradas > 1 ? 'es' : ''} retirada${diff.seccionesRetiradas > 1 ? 's' : ''}`);
  }
  if (diff.textosEditados > 0 && partes.length === 0) {
    partes.push(`${diff.textosEditados} redacción${diff.textosEditados > 1 ? 'es' : ''} corregida${diff.textosEditados > 1 ? 's' : ''}`);
  }

  return partes.length > 0 ? partes.join(' · ') : 'Ajuste menor de estructura';
}

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
      requiereHallazgo: pregunta.requiereHallazgo ?? true,
    })),
  })),
});

export const mapearFormularioDetalle = (formulario: FormularioConRevisiones) => {
  const revisionesDesc = [...formulario.versiones].sort((a, b) => b.numeroVersion - a.numeroVersion);
  const actual = revisionesDesc.find((revision) => revision.activa) ?? revisionesDesc[0] ?? null;

  // Mapa para calcular diferencias respecto a la versión anterior (numeroVersion - 1)
  const mapaPorNumero = new Map(revisionesDesc.map((rev) => [rev.numeroVersion, rev]));

  return {
    id: formulario.id,
    nombre: formulario.nombre,
    descripcion: formulario.descripcion,
    alcance: formulario.alcance,
    activo: formulario.activo,
    creadoEn: formulario.creadoEn,
    actualizadoEn: formulario.actualizadoEn,
    actual: actual ? mapearRevisionFormulario(actual, true) : null,
    historial: revisionesDesc.map((revision) => {
      const resumen = mapearRevisionFormulario(revision, actual?.id === revision.id);
      const versionAnterior = mapaPorNumero.get(revision.numeroVersion - 1);
      const diferencias = versionAnterior ? calcularDiferenciasEstructura(versionAnterior, revision) : null;

      return {
        id: resumen.id,
        numeroVersion: revision.numeroVersion,
        activa: revision.activa,
        actual: resumen.actual,
        creadoEn: resumen.creadoEn,
        actualizadoEn: resumen.actualizadoEn,
        totalSecciones: resumen.totalSecciones,
        totalPreguntas: resumen.totalPreguntas,
        resumenDiferencias: diferencias ? generarTextoDiferencias(diferencias) : (revision.numeroVersion === 1 ? 'Versión inicial' : null),
        diferencias,
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
          requiereHallazgo: pregunta.requiereHallazgo ?? true,
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
      requiereHallazgo: pregunta.requiereHallazgo ?? true,
    })),
  })))
);

// Estructuras son idénticas si coinciden secciones, preguntas, orden, requiereHallazgo y textos
export const estructurasFormularioIguales = (
  revision: RevisionConEstructura,
  secciones: EstructuraFormularioEntrada['secciones'],
) => JSON.stringify(normalizarRevisionBase(revision)) === JSON.stringify(normalizarEstructuraBase(secciones));

// Cambio estructural: difiere cantidad de secciones/preguntas, la identidad claveEstable de secciones, o la pertenencia de una pregunta (claveEstable) a una sección distinta.
// NO es estructural (es INMEDIATO): cambio de texto, requiereHallazgo, orden de preguntas dentro de la misma sección, orden visual de secciones, o título/objetivo de sección.
export const esCambioEstructural = (
  revision: RevisionConEstructura,
  seccionesEntrada: EstructuraFormularioEntrada['secciones'],
) => {
  const actualNorm = normalizarRevisionBase(revision);
  const entradaNorm = normalizarEstructuraBase(seccionesEntrada);

  // 1. Difiere número de secciones
  if (actualNorm.length !== entradaNorm.length) return true;

  // 2. Mapa de claveEstable de pregunta -> claveEstable de sección en la versión actual
  const mapaPreguntaASeccionActual = new Map<string, string>();
  let totalPreguntasActual = 0;
  for (const sec of actualNorm) {
    if (sec.claveEstable) {
      for (const preg of sec.preguntas) {
        if (preg.claveEstable) {
          mapaPreguntaASeccionActual.set(preg.claveEstable, sec.claveEstable);
          totalPreguntasActual++;
        }
      }
    }
  }

  let totalPreguntasEntrada = 0;
  for (const sec of entradaNorm) {
    for (const preg of sec.preguntas) {
      if (preg.claveEstable) {
        totalPreguntasEntrada++;
        const seccionActualKey = mapaPreguntaASeccionActual.get(preg.claveEstable);
        // Pregunta nueva no existente previamente en el snapshot actual
        if (!seccionActualKey) return true;
        // Pregunta movida a otra sección diferente (cambia pertenencia de grupo)
        if (seccionActualKey !== sec.claveEstable) return true;
      }
    }
  }

  // Si la cantidad total de preguntas cambió (p.ej. se eliminó alguna pregunta)
  if (totalPreguntasActual !== totalPreguntasEntrada) return true;

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
    // Actualizar in-place textos, orden y requiereHallazgo de secciones y preguntas en TODAS las versiones del mismo formulario que compartan la misma claveEstable
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
            orden: secEntrada.orden,
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
              orden: pregEntrada.orden,
              requiereHallazgo: pregEntrada.requiereHallazgo !== false,
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
  // Siempre aplicamos in-place las propiedades inmediatas (texto, requiereHallazgo, orden) sobre las versiones existentes que compartan claveEstable
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
          orden: secEntrada.orden,
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
            orden: pregEntrada.orden,
            requiereHallazgo: pregEntrada.requiereHallazgo !== false,
          },
        });
      }
    }
  }

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
          orden: seccion.orden,
          preguntas: {
            create: seccion.preguntas.map((pregunta) => ({
              claveEstable: pregunta.claveEstable ?? generarUuid(),
              texto: pregunta.texto.trim(),
              orden: pregunta.orden,
              requiereHallazgo: pregunta.requiereHallazgo ?? true,
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
    ? 'Los ajustes de presentación se aplicaron de inmediato. Los cambios que afectan la evaluación se aplicarán a partir del próximo mes.'
    : 'Cambios guardados y aplicados al periodo actual.';

  return {
    revision: creada,
    creada: true,
    tipoCambio: 'ESTRUCTURAL',
    aplicadoMesSiguiente: mesCongelado,
    mensaje,
  };
};
