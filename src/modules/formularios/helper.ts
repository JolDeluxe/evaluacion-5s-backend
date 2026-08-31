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

const normalizarParaComparacion = (secciones: EstructuraFormularioEntrada['secciones']) => (
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

const normalizarRevisionParaComparacion = (revision: RevisionConEstructura) => (
  normalizarParaComparacion(revision.secciones.map((seccion) => ({
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

export const estructurasFormularioIguales = (
  revision: RevisionConEstructura,
  secciones: EstructuraFormularioEntrada['secciones'],
) => JSON.stringify(normalizarRevisionParaComparacion(revision)) === JSON.stringify(normalizarParaComparacion(secciones));

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
    return { revision: revisionActual, creada: false };
  }

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

  await registrarAuditoria({
    usuarioId,
    accion: 'CREAR_REVISION_FORMULARIO',
    tipoEntidad: 'VersionFormulario',
    idEntidad: creada.id,
    datosAnteriores: revisionActual,
    datosNuevos: creada,
  }, tx);

  return { revision: creada, creada: true };
};
