import type { Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../../db';
import { RolUsuario } from '../../generated/prisma/enums';
import { normalizarCorreo } from '../../utils/crypto';
import { calcularCierreConGracia, mesAnteriorDe, MESES_NOMBRES, primerDiaHabilMes } from '../../utils/periodos';
import { responder } from '../../utils/respuesta';
import { obtenerVistaMensual } from '../asignaciones/programacion_mensual';
import { obtenerResultadosGeneral } from '../resultados/servicio';

const esquemaSimulacion = z.object({
  tipo: z.enum(['asignaciones', 'resultados']).default('asignaciones'),
  anio: z.coerce.number().int().min(2000).max(2100).optional(),
  mes: z.coerce.number().int().min(1).max(12).optional(),
});

export const simularCorreosSistema = async (req: Request, res: Response) => {
  const query = esquemaSimulacion.parse(req.query);
  const ahora = new Date();

  if (query.tipo === 'asignaciones') {
    const anio = query.anio ?? ahora.getFullYear();
    const mes = query.mes ?? ahora.getMonth() + 1;
    const yyyyMM = `${anio}-${String(mes).padStart(2, '0')}`;
    const mesEtiqueta = `${MESES_NOMBRES[mes - 1]} ${anio}`;
    const primerDiaHabil = primerDiaHabilMes(anio, mes);
    const esElegibleFecha = ahora >= primerDiaHabil;

    const vista = await obtenerVistaMensual(prisma, anio, mes);

    const asignacionesPorAuditor = new Map<
      number,
      { auditorId: number; nombre: string; areas: string[] }
    >();

    for (const fila of vista.filas) {
      if (!fila.auditorMensual) continue;
      const auditorId = fila.auditorMensual.id;
      const actual = asignacionesPorAuditor.get(auditorId) ?? {
        auditorId,
        nombre: fila.auditorMensual.nombre,
        areas: [],
      };
      if (fila.area.nombre && !actual.areas.includes(fila.area.nombre)) {
        actual.areas.push(fila.area.nombre);
      }
      asignacionesPorAuditor.set(auditorId, actual);
    }

    const auditorIds = Array.from(asignacionesPorAuditor.keys());
    const usuarios = auditorIds.length > 0
      ? await prisma.usuario.findMany({
          where: { id: { in: auditorIds } },
          select: { id: true, nombre: true, correo: true, activo: true, rol: true },
        })
      : [];

    const destinatarios = [];
    for (const usuario of usuarios) {
      if (!usuario.activo) continue;
      const datosAuditor = asignacionesPorAuditor.get(usuario.id);
      if (!datosAuditor || datosAuditor.areas.length === 0) continue;

      const claveDedupe = `asignacion-mensual-correo:${usuario.id}:${yyyyMM}`;
      const notifExistente = await prisma.notificacion.findUnique({
        where: { claveDedupe },
        include: {
          entregasNotificacion: {
            where: { canal: 'CORREO' },
            select: { id: true, estado: true, enviadoEn: true, ultimoError: true },
          },
        },
      });

      const correoNormalizado = normalizarCorreo(usuario.correo);
      let accionSimulada: 'ENVIAR_CORREO' | 'IGNORAR_DUPLICADO' | 'CANCELAR_SIN_CORREO';

      if (notifExistente) {
        accionSimulada = 'IGNORAR_DUPLICADO';
      } else if (!correoNormalizado) {
        accionSimulada = 'CANCELAR_SIN_CORREO';
      } else {
        accionSimulada = 'ENVIAR_CORREO';
      }

      destinatarios.push({
        usuarioId: usuario.id,
        nombre: usuario.nombre,
        correo: usuario.correo,
        correoNormalizado,
        rol: usuario.rol,
        areas: datosAuditor.areas,
        claveDedupe,
        yaExisteEnBd: Boolean(notifExistente),
        entregaExistente: notifExistente?.entregasNotificacion[0] ?? null,
        accionSimulada,
      });
    }

    return responder(res, {
      simulacion: {
        tipo: 'asignaciones',
        anio,
        mes,
        mesEtiqueta,
        primerDiaHabil: primerDiaHabil.toISOString(),
        esElegiblePorFecha: esElegibleFecha,
        resumen: {
          totalDestinatarios: destinatarios.length,
          aEnviar: destinatarios.filter((d) => d.accionSimulada === 'ENVIAR_CORREO').length,
          yaRegistrados: destinatarios.filter((d) => d.accionSimulada === 'IGNORAR_DUPLICADO').length,
          sinCorreo: destinatarios.filter((d) => d.accionSimulada === 'CANCELAR_SIN_CORREO').length,
        },
        destinatarios,
      },
    });
  }

  // Simulación de Resultados
  const mesObjetivo = (query.anio !== undefined && query.mes !== undefined)
    ? { anio: query.anio, mes: query.mes }
    : mesAnteriorDe(ahora.getFullYear(), ahora.getMonth() + 1);

  const { anio, mes } = mesObjetivo;
  const yyyyMM = `${anio}-${String(mes).padStart(2, '0')}`;
  const mesEtiqueta = `${MESES_NOMBRES[mes - 1]} ${anio}`;

  const objetivos = await prisma.objetivoAuditoria.findMany({
    where: { anio, mes, canceladoEn: null },
    select: { id: true, terminaEn: true, nombreAreaSnapshot: true },
  });

  const todosPostGracia = objetivos.length > 0 && objetivos.every(
    (obj) => ahora > calcularCierreConGracia(obj.terminaEn)
  );

  const authInterna = { usuarioId: 0, rol: RolUsuario.SUPER_ADMIN };
  const datosGeneral = await obtenerResultadosGeneral(prisma, authInterna, {
    tipo: 'mes',
    mes: yyyyMM,
  });

  const areasConResultado = (datosGeneral.areas ?? []) as Array<{
    area: { id: number; nombre: string; codigo: string; tipo: import('../../generated/prisma/enums').TipoArea };
    resultadoMensual?: number | null;
  }>;
  const areaIds = areasConResultado.map((a) => a.area.id);

  const usuariosArea = areaIds.length > 0
    ? await prisma.usuarioArea.findMany({
        where: { areaId: { in: areaIds } },
        include: {
          usuario: {
            select: { id: true, nombre: true, correo: true, rol: true, activo: true },
          },
        },
      })
    : [];

  type AreaItem = { nombre: string; resultado: number | null };
  const porUsuario = new Map<
    number,
    {
      usuario: { id: number; nombre: string; correo: string | null; rol: RolUsuario; activo: boolean };
      areas: AreaItem[];
    }
  >();

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

  const administradores = await prisma.usuario.findMany({
    where: {
      activo: true,
      rol: { in: [RolUsuario.ADMINISTRADOR, RolUsuario.SUPER_ADMIN] },
    },
    select: { id: true, nombre: true, correo: true, rol: true, activo: true },
  });

  for (const admin of administradores) {
    if (!porUsuario.has(admin.id)) {
      porUsuario.set(admin.id, { usuario: admin, areas: [] });
    }
  }

  const destinatarios = [];
  for (const [usuarioId, { usuario, areas }] of porUsuario.entries()) {
    const claveDedupe = `resultado-mensual-correo:${usuarioId}:${yyyyMM}`;
    const notifExistente = await prisma.notificacion.findUnique({
      where: { claveDedupe },
      include: {
        entregasNotificacion: {
          where: { canal: 'CORREO' },
          select: { id: true, estado: true, enviadoEn: true, ultimoError: true },
        },
      },
    });

    const correoNormalizado = normalizarCorreo(usuario.correo);
    let accionSimulada: 'ENVIAR_CORREO' | 'IGNORAR_DUPLICADO' | 'CANCELAR_SIN_CORREO';

    if (notifExistente) {
      accionSimulada = 'IGNORAR_DUPLICADO';
    } else if (!correoNormalizado) {
      accionSimulada = 'CANCELAR_SIN_CORREO';
    } else {
      accionSimulada = 'ENVIAR_CORREO';
    }

    destinatarios.push({
      usuarioId: usuario.id,
      nombre: usuario.nombre,
      correo: usuario.correo,
      correoNormalizado,
      rol: usuario.rol,
      areas,
      claveDedupe,
      yaExisteEnBd: Boolean(notifExistente),
      entregaExistente: notifExistente?.entregasNotificacion[0] ?? null,
      accionSimulada,
    });
  }

  return responder(res, {
    simulacion: {
      tipo: 'resultados',
      anio,
      mes,
      mesEtiqueta,
      objetivosTotales: objetivos.length,
      todosPostGracia,
      resultadoGeneral: datosGeneral.resultadoGeneral ?? null,
      resumen: {
        totalDestinatarios: destinatarios.length,
        aEnviar: destinatarios.filter((d) => d.accionSimulada === 'ENVIAR_CORREO').length,
        yaRegistrados: destinatarios.filter((d) => d.accionSimulada === 'IGNORAR_DUPLICADO').length,
        sinCorreo: destinatarios.filter((d) => d.accionSimulada === 'CANCELAR_SIN_CORREO').length,
      },
      destinatarios,
    },
  });
};