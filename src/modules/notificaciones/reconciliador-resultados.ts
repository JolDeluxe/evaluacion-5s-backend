import type { PrismaTransaction } from '../../db';
import { prisma } from '../../db';
import {
  CanalNotificacion,
  EstadoEntregaNotificacion,
  RolUsuario,
  TipoNotificacion,
} from '../../generated/prisma/enums';
import { hashSha256, normalizarCorreo } from '../../utils/crypto';
import { calcularCierreConGracia, mesAnteriorDe, MESES_NOMBRES } from '../../utils/periodos';
import { appUrl } from '../../utils/app-urls';
import { obtenerResultadosGeneral } from '../resultados/servicio';

export type ResultadoReconciliacionResultados = {
  revisados: number;
  creadas: number;
  duplicadas: number;
  sinCorreo: number;
};

/**
 * Reconcilia de forma idempotente las obligaciones de notificación por correo
 * para los resultados mensuales definitivos (post-cierre de periodo de gracia).
 *
 * Reglas:
 * - Se ejecuta para el mes indicado (o por defecto el mes inmediatamente anterior).
 * - Verifica que TODOS los objetivos activos del mes hayan superado su fecha límite con días de gracia.
 * - Consume directamente el servicio canónico de Resultados (obtenerResultadosGeneral).
 * - Consolidación por usuario: claveDedupe = "resultado-mensual-correo:{usuarioId}:{YYYY-MM}".
 * - Un usuario responsable de múltiples áreas recibe UN SOLO correo con todas sus áreas + resultado general.
 * - Un ADMINISTRADOR/SUPER_ADMIN sin áreas recibe un único correo con el resultado general.
 * - Un ADMINISTRADOR responsable de áreas recibe el mismo correo consolidado (no dos correos).
 * - AUDITOR sin áreas asignadas como responsable NO recibe resultados.
 */
export const reconciliarResultados = async (
  tx: PrismaTransaction | typeof prisma = prisma,
  targetAnio?: number,
  targetMes?: number,
  ahora = new Date(),
): Promise<ResultadoReconciliacionResultados> => {
  const mesObjetivo = (targetAnio !== undefined && targetMes !== undefined)
    ? { anio: targetAnio, mes: targetMes }
    : mesAnteriorDe(ahora.getFullYear(), ahora.getMonth() + 1);

  const { anio, mes } = mesObjetivo;
  const yyyyMM = `${anio}-${String(mes).padStart(2, '0')}`;
  const mesEtiqueta = `${MESES_NOMBRES[mes - 1]} ${anio}`;

  // 1. Verificar si existen objetivos y si TODOS superaron su periodo de gracia
  const objetivos = await tx.objetivoAuditoria.findMany({
    where: { anio, mes, canceladoEn: null },
    select: { id: true, terminaEn: true },
  });

  if (objetivos.length === 0) {
    return { revisados: 0, creadas: 0, duplicadas: 0, sinCorreo: 0 };
  }

  const todosPostGracia = objetivos.every(
    (obj) => ahora > calcularCierreConGracia(obj.terminaEn),
  );

  if (!todosPostGracia) {
    // Aún en período de gracia para al menos un objetivo
    return { revisados: 0, creadas: 0, duplicadas: 0, sinCorreo: 0 };
  }

  // 2. Obtener resultados canónicos
  const authInterna = { usuarioId: 0, rol: RolUsuario.SUPER_ADMIN };
  const datosGeneral = await obtenerResultadosGeneral(tx as PrismaTransaction, authInterna, {
    tipo: 'mes',
    mes: yyyyMM,
  });

  const areasConResultado = (datosGeneral.areas ?? []) as Array<{
    area: { id: number; nombre: string; codigo: string; tipo: import('../../generated/prisma/enums').TipoArea };
    resultadoMensual?: number | null;
  }>;
  const areaIds = areasConResultado.map((a) => a.area.id);

  // 3. Obtener responsables de las áreas (UsuarioArea)
  const usuariosArea = await tx.usuarioArea.findMany({
    where: { areaId: { in: areaIds } },
    include: {
      usuario: {
        select: { id: true, nombre: true, correo: true, rol: true, activo: true },
      },
    },
  });

  // 4. Mapa consolidado por usuarioId
  type AreaPayload = { nombre: string; resultado: number | null };
  const porUsuario = new Map<
    number,
    {
      usuario: { id: number; nombre: string; correo: string | null; rol: RolUsuario; activo: boolean };
      areas: AreaPayload[];
    }
  >();

  // Agregar responsables de área
  for (const relacion of usuariosArea) {
    const usuario = relacion.usuario;
    if (!usuario.activo) continue;

    const areaData = areasConResultado.find((a) => a.area.id === relacion.areaId);
    if (!areaData) continue;

    const actual = porUsuario.get(usuario.id) ?? { usuario, areas: [] };
    if (!actual.areas.some((a) => a.nombre === areaData.area.nombre)) {
      actual.areas.push({
        nombre: areaData.area.nombre,
        resultado: areaData.resultadoMensual ?? null,
      });
    }
    porUsuario.set(usuario.id, actual);
  }

  // 5. Agregar ADMINISTRADORES y SUPER_ADMINS activos
  const administradores = await tx.usuario.findMany({
    where: {
      activo: true,
      rol: { in: [RolUsuario.ADMINISTRADOR, RolUsuario.SUPER_ADMIN] },
    },
    select: { id: true, nombre: true, correo: true, rol: true, activo: true },
  });

  for (const admin of administradores) {
    if (!porUsuario.has(admin.id)) {
      // Admin sin áreas asignadas directamente
      porUsuario.set(admin.id, { usuario: admin, areas: [] });
    }
    // Si ya existe (admin con áreas), conserva sus áreas y no duplica entrada
  }

  if (porUsuario.size === 0) {
    return { revisados: 0, creadas: 0, duplicadas: 0, sinCorreo: 0 };
  }

  const urlResultados = appUrl(`/resultados/general?tipo=mes&mes=${yyyyMM}`);
  let creadas = 0;
  let duplicadas = 0;
  let sinCorreo = 0;

  for (const [usuarioId, { usuario, areas }] of porUsuario.entries()) {
    const claveDedupe = `resultado-mensual-correo:${usuarioId}:${yyyyMM}`;

    const existente = await tx.notificacion.findUnique({
      where: { claveDedupe },
    });

    if (existente) {
      duplicadas += 1;
      continue;
    }

    const formatPct = (val: number | null) => (val !== null && val !== undefined ? `${val.toFixed(1)}%` : '—');

    const mensaje = areas.length > 0
      ? `Hola ${usuario.nombre}, están listos los resultados de ${mesEtiqueta}. Tus áreas: ${areas.map((a) => `${a.nombre}: ${formatPct(a.resultado)}`).join(', ')}. General: ${formatPct(datosGeneral.resultadoGeneral)}.`
      : `Hola ${usuario.nombre}, están listos los resultados de ${mesEtiqueta}. Resultado general: ${formatPct(datosGeneral.resultadoGeneral)}.`;

    const payloadDatos = {
      templateName: 'monthly_results' as const,
      templateVersion: 'v1' as const,
      destinatarioNombre: usuario.nombre,
      mes: yyyyMM,
      mesEtiqueta,
      areas,
      resultadoGeneral: datosGeneral.resultadoGeneral ?? null,
      urlResultados,
    };

    const notificacion = await tx.notificacion.create({
      data: {
        usuarioId: usuario.id,
        claveDedupe,
        tipo: TipoNotificacion.RESULTADO_MENSUAL_CORREO,
        titulo: `Resultados 5S — ${mesEtiqueta}`,
        mensaje,
        ruta: `/resultados/general?tipo=mes&mes=${yyyyMM}`,
        datos: payloadDatos,
      },
    });

    const correoNormalizado = normalizarCorreo(usuario.correo);
    if (correoNormalizado) {
      const destinoHash = hashSha256(correoNormalizado);
      await tx.entregaNotificacion.create({
        data: {
          notificacionId: notificacion.id,
          canal: CanalNotificacion.CORREO,
          estado: EstadoEntregaNotificacion.PENDIENTE,
          destinoSnapshot: correoNormalizado,
          destinoHash,
          programadoEn: ahora,
        },
      });
      creadas += 1;
    } else {
      const dummyHash = hashSha256(`sin-correo:${usuario.id}`);
      await tx.entregaNotificacion.create({
        data: {
          notificacionId: notificacion.id,
          canal: CanalNotificacion.CORREO,
          estado: EstadoEntregaNotificacion.CANCELADA,
          destinoSnapshot: 'sin-correo',
          destinoHash: dummyHash,
          ultimoError: 'El usuario no tiene correo electrónico registrado.',
          programadoEn: ahora,
        },
      });
      sinCorreo += 1;
    }
  }

  return {
    revisados: porUsuario.size,
    creadas,
    duplicadas,
    sinCorreo,
  };
};