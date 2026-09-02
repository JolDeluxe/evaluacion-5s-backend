/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, test } from 'bun:test';
import { EstadoAsignacionAuditoria, RolUsuario, TipoArea, AlcanceFormulario } from '../generated/prisma/enums';
import {
  asegurarProgramacionMensual,
  autoasignarPendientes,
  calcularPropuestaAutoasignacion,
  confirmarPropuestaAutoasignacion,
  guardarAsignacionMensual,
  obtenerVistaMensual,
  puedeAsegurarProgramacionMensual,
} from '../modules/asignaciones/programacion_mensual';
import { puedeUsarAsignacionEjecutable } from '../modules/asignaciones/helper';
import { reabrirAsignacionEnTransaccion } from '../modules/asignaciones/12_reabrir';
import { objetivoEsRealizable } from '../utils/periodos';
import { liberarAsignacionesDeAuditorNoEjecutable, puedeUsuarioAuditar } from '../modules/asignaciones/servicio_reasignacion';

const date = (anio: number, mes: number, dia: number) => new Date(anio, mes - 1, dia, 12, 0, 0, 0);

type FakeOptions = {
  responsablesArea1?: number[];
  soloArea1?: boolean;
};

class FakeTx {
  nextObjetivoId = 1;
  nextAsignacionId = 1;
  nextAsignacionMensualId = 1;
  registros: unknown[] = [];
  versiones = [
    { id: 101, formularioId: 1, numeroVersion: 1, activa: true, formulario: { activo: true, alcance: AlcanceFormulario.OPERATIVO } },
    { id: 201, formularioId: 2, numeroVersion: 1, activa: true, formulario: { activo: true, alcance: AlcanceFormulario.ADMINISTRATIVO } },
  ];
  usuarios = [
    { id: 1, nombre: 'Admin', nombreUsuario: 'admin', rol: RolUsuario.ADMINISTRADOR, activo: true },
    { id: 10, nombre: 'Juan Perez', nombreUsuario: 'juan', rol: RolUsuario.AUDITOR, activo: true },
    { id: 11, nombre: 'Pedro Ruiz', nombreUsuario: 'pedro', rol: RolUsuario.AUDITOR, activo: true },
  ];
  areas;
  objetivos: any[] = [];
  asignacionesMensuales: any[] = [];
  asignacionesAuditoria: any[] = [];

  constructor(options: FakeOptions = {}) {
    this.areas = [
      {
        id: 1,
        codigo: 'A-1',
        nombre: 'Produccion',
        tipo: TipoArea.OPERATIVA,
        activo: true,
        auditableDesde: null,
        auditableHasta: null,
        usuariosArea: (options.responsablesArea1 ?? []).map((usuarioId) => ({ usuarioId })),
      },
      ...(options.soloArea1 ? [] : [{
        id: 2,
        codigo: 'A-2',
        nombre: 'Administracion',
        tipo: TipoArea.ADMINISTRATIVA,
        activo: true,
        auditableDesde: null,
        auditableHasta: null,
        usuariosArea: [],
      }]),
    ];
  }

  area = {
    findMany: async () => this.areas,
  };

  versionFormulario = {
    findMany: async ({ where }: any) => this.versiones
      .filter((version) => where.formulario.alcance.in.includes(version.formulario.alcance))
      .sort((a, b) => b.numeroVersion - a.numeroVersion),
  };

  envioAuditoria = {
    findFirst: async () => null,
  };

  usuario = {
    findMany: async ({ where }: any) => this.usuarios
      .filter((usuario) => usuario.activo === where.activo && where.rol.in.includes(usuario.rol))
      .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')),
    findUniqueOrThrow: async ({ where }: any) => {
      const usuario = this.usuarios.find((actual) => actual.id === where.id);
      if (!usuario) throw new Error('Usuario no encontrado');
      return usuario;
    },
  };

  usuarioArea = {
    findFirst: async ({ where }: any) => {
      const area = this.areas.find((actual) => actual.id === where.areaId);
      return area?.usuariosArea.some((relacion) => relacion.usuarioId === where.usuarioId)
        ? { id: 1 }
        : null;
    },
  };

  objetivoAuditoria = {
    upsert: async ({ where, create }: any) => {
      const key = where.areaId_anio_mes_periodo;
      let objetivo = this.objetivos.find((actual) => (
        actual.areaId === key.areaId
          && actual.anio === key.anio
          && actual.mes === key.mes
          && actual.periodo === key.periodo
      ));
      if (!objetivo) {
        objetivo = {
          id: this.nextObjetivoId++,
          envioResultadoId: null,
          envioResultado: null,
          enviosAuditoria: [],
          canceladoEn: null,
          ...create,
        };
        this.objetivos.push(objetivo);
      }
      return objetivo;
    },
    findMany: async ({ where = {} }: any) => this.objetivos
      .filter((objetivo) => this.matchObjetivo(objetivo, where))
      .map((objetivo) => this.decorateObjetivo(objetivo)),
    findUniqueOrThrow: async ({ where }: any) => {
      const objetivo = this.objetivos.find((actual) => actual.id === where.id);
      if (!objetivo) throw new Error('Objetivo no encontrado');
      return this.decorateObjetivo(objetivo);
    },
  };

  asignacionMensual = {
    findMany: async ({ where }: any) => this.asignacionesMensuales
      .filter((asignacion) => asignacion.anio === where.anio && asignacion.mes === where.mes)
      .map((asignacion) => ({
        ...asignacion,
        auditor: this.usuarios.find((usuario) => usuario.id === asignacion.auditorId),
      })),
    upsert: async ({ where, update, create }: any) => {
      const key = where.areaId_anio_mes;
      let asignacion = this.asignacionesMensuales.find((actual) => (
        actual.areaId === key.areaId && actual.anio === key.anio && actual.mes === key.mes
      ));
      if (asignacion) {
        Object.assign(asignacion, update, { actualizadoEn: new Date() });
      } else {
        asignacion = {
          id: this.nextAsignacionMensualId++,
          creadoEn: new Date(),
          actualizadoEn: new Date(),
          ...create,
        };
        this.asignacionesMensuales.push(asignacion);
      }
      return asignacion;
    },
    deleteMany: async ({ where }: any) => {
      const ids = new Set(where.id.in);
      const anteriores = this.asignacionesMensuales.length;
      this.asignacionesMensuales = this.asignacionesMensuales.filter((item) => (
        !ids.has(item.id) || item.auditorId !== where.auditorId
      ));
      return { count: anteriores - this.asignacionesMensuales.length };
    },
  };

  asignacionAuditoria = {
    findMany: async ({ where }: any) => this.asignacionesAuditoria
      .filter((asignacion) => (
        asignacion.auditorId === where.auditorId
        && asignacion.estado !== where.estado.not
        && (!where.objetivoAuditoria?.areaId
          || this.objetivos.find((objetivo) => objetivo.id === asignacion.objetivoAuditoriaId)?.areaId === where.objetivoAuditoria.areaId)
      ))
      .map((asignacion) => ({
        ...asignacion,
        objetivoAuditoria: this.decorateObjetivo(
          this.objetivos.find((objetivo) => objetivo.id === asignacion.objetivoAuditoriaId),
        ),
      })),
    create: async ({ data }: any) => {
      const asignacion = {
        id: this.nextAsignacionId++,
        estado: EstadoAsignacionAuditoria.PENDIENTE,
        asignadoEn: null,
        iniciadoEn: null,
        completadoEn: null,
        canceladoEn: null,
        motivoCancelacion: null,
        motivoExcepcion: null,
        reabiertaHasta: null,
        reabiertaEn: null,
        reabiertaPorId: null,
        motivoReapertura: null,
        creadoEn: new Date(),
        actualizadoEn: new Date(),
        ...data,
      };
      this.asignacionesAuditoria.push(asignacion);
      return asignacion;
    },
    update: async ({ where, data }: any) => {
      const asignacion = this.asignacionesAuditoria.find((actual) => actual.id === where.id);
      if (!asignacion) throw new Error('Asignacion no encontrada');
      Object.assign(asignacion, data, { actualizadoEn: new Date() });
      return {
        ...asignacion,
        objetivoAuditoria: this.decorateObjetivo(
          this.objetivos.find((objetivo) => objetivo.id === asignacion.objetivoAuditoriaId),
        ),
        auditor: this.usuarios.find((usuario) => usuario.id === asignacion.auditorId),
      };
    },
    updateMany: async ({ where, data }: any) => {
      let count = 0;
      for (const asignacion of this.asignacionesAuditoria) {
        if (where.asignacionMensualId?.in && !where.asignacionMensualId.in.includes(asignacion.asignacionMensualId)) continue;
        Object.assign(asignacion, data, { actualizadoEn: new Date() });
        count += 1;
      }
      return { count };
    },
    findUniqueOrThrow: async ({ where }: any) => {
      const asignacion = this.asignacionesAuditoria.find((actual) => actual.id === where.id);
      if (!asignacion) throw new Error('Asignacion no encontrada');
      return {
        ...asignacion,
        objetivoAuditoria: this.decorateObjetivo(
          this.objetivos.find((objetivo) => objetivo.id === asignacion.objetivoAuditoriaId),
        ),
      };
    },
  };

  enlaceInvitado = {
    updateMany: async () => ({ count: 0 }),
  };

  registroAuditoria = {
    create: async ({ data }: any) => {
      this.registros.push(data);
      return { id: this.registros.length, ...data };
    },
  };

  matchObjetivo(objetivo: any, where: any) {
    if (where.id && objetivo.id !== where.id) return false;
    if (where.areaId && objetivo.areaId !== where.areaId) return false;
    if (where.anio && objetivo.anio !== where.anio) return false;
    if (where.mes && objetivo.mes !== where.mes) return false;
    if (where.periodo?.in && !where.periodo.in.includes(objetivo.periodo)) return false;
    if (where.terminaEn?.lt && !(objetivo.terminaEn < where.terminaEn.lt)) return false;
    return true;
  }

  decorateObjetivo(objetivo: any) {
    const area = this.areas.find((actual) => actual.id === objetivo.areaId);
    const asignacionesAuditoria = this.asignacionesAuditoria
      .filter((asignacion) => asignacion.objetivoAuditoriaId === objetivo.id)
      .sort((a, b) => a.estado.localeCompare(b.estado) || b.actualizadoEn.getTime() - a.actualizadoEn.getTime())
      .map((asignacion) => ({
        ...asignacion,
        auditor: this.usuarios.find((usuario) => usuario.id === asignacion.auditorId),
        asignacionMensual: this.asignacionesMensuales.find((mensual) => mensual.id === asignacion.asignacionMensualId) ?? null,
      }));
    return {
      ...objetivo,
      area,
      envioResultado: objetivo.envioResultado ?? null,
      enviosAuditoria: objetivo.enviosAuditoria ?? [],
      asignacionesAuditoria,
    };
  }

  objetivosDeAreaMes(areaId: number, anio: number, mes: number) {
    return this.objetivos
      .filter((objetivo) => objetivo.areaId === areaId && objetivo.anio === anio && objetivo.mes === mes)
      .sort((a, b) => a.periodo - b.periodo);
  }

  asignacionVigente(objetivoId: number) {
    return this.asignacionesAuditoria.find((asignacion) => (
      asignacion.objetivoAuditoriaId === objetivoId
        && asignacion.estado !== EstadoAsignacionAuditoria.CANCELADA
    )) ?? null;
  }
}

const prepararMes = async (tx: FakeTx, anio = 2026, mes = 9) => {
  await asegurarProgramacionMensual(tx as any, anio, mes, 1);
};

describe('Asignacion mensual simplificada', () => {
  test('asignar Juan crea AsignacionMensual y P1/P2 para Juan', async () => {
    const tx = new FakeTx({ soloArea1: true });
    await prepararMes(tx);

    const resultado = await guardarAsignacionMensual(tx as any, {
      areaId: 1,
      anio: 2026,
      mes: 9,
      auditorMensualId: 10,
      asignadoPorId: 1,
    });

    expect(resultado.actualizadas).toBe(2);
    expect(tx.asignacionesMensuales[0].auditorId).toBe(10);
    expect(tx.objetivosDeAreaMes(1, 2026, 9).map((objetivo) => tx.asignacionVigente(objetivo.id)?.auditorId)).toEqual([10, 10]);
  });

  test('P1 y P2 pendientes cambian de Juan a Pedro', async () => {
    const tx = new FakeTx({ soloArea1: true });
    await prepararMes(tx);
    await guardarAsignacionMensual(tx as any, { areaId: 1, anio: 2026, mes: 9, auditorMensualId: 10, asignadoPorId: 1 });

    const resultado = await guardarAsignacionMensual(tx as any, { areaId: 1, anio: 2026, mes: 9, auditorMensualId: 11, asignadoPorId: 1 });

    expect(resultado.actualizadas).toBe(2);
    expect(tx.asignacionesMensuales[0].auditorId).toBe(11);
    expect(tx.objetivosDeAreaMes(1, 2026, 9).map((objetivo) => tx.asignacionVigente(objetivo.id)?.auditorId)).toEqual([11, 11]);
  });

  test('P1 completada conserva Juan y P2 pendiente pasa a Pedro', async () => {
    const tx = new FakeTx({ soloArea1: true });
    await prepararMes(tx);
    await guardarAsignacionMensual(tx as any, { areaId: 1, anio: 2026, mes: 9, auditorMensualId: 10, asignadoPorId: 1 });
    const p1 = tx.objetivosDeAreaMes(1, 2026, 9)[0];
    Object.assign(tx.asignacionVigente(p1.id), {
      estado: EstadoAsignacionAuditoria.COMPLETADA,
      completadoEn: date(2026, 9, 10),
    });

    const resultado = await guardarAsignacionMensual(tx as any, { areaId: 1, anio: 2026, mes: 9, auditorMensualId: 11, asignadoPorId: 1 });

    expect(resultado.protegidas).toBe(1);
    expect(tx.asignacionesMensuales[0].auditorId).toBe(11);
    expect(tx.objetivosDeAreaMes(1, 2026, 9).map((objetivo) => tx.asignacionVigente(objetivo.id)?.auditorId)).toEqual([10, 11]);
  });

  test('baja a mitad de mes conserva P1 completada y permite sustituir solo P2', async () => {
    const tx = new FakeTx({ soloArea1: true });
    await prepararMes(tx);
    await guardarAsignacionMensual(tx as any, { areaId: 1, anio: 2026, mes: 9, auditorMensualId: 10, asignadoPorId: 1 });
    const [p1, p2] = tx.objetivosDeAreaMes(1, 2026, 9);
    const asignacionP1 = tx.asignacionVigente(p1.id);
    Object.assign(asignacionP1, {
      estado: EstadoAsignacionAuditoria.COMPLETADA,
      completadoEn: date(2026, 9, 10),
    });

    const liberacion = await liberarAsignacionesDeAuditorNoEjecutable(tx as any, 10, 'AUDITOR_INACTIVO');

    expect(liberacion.liberadas).toBe(1);
    expect(tx.asignacionVigente(p1.id)?.auditorId).toBe(10);
    expect(tx.asignacionVigente(p2.id)).toBeNull();
    expect(tx.asignacionesMensuales).toHaveLength(0);

    await guardarAsignacionMensual(tx as any, {
      areaId: 1,
      anio: 2026,
      mes: 9,
      auditorMensualId: 11,
      asignadoPorId: 1,
    });

    expect(tx.asignacionVigente(p1.id)?.auditorId).toBe(10);
    expect(tx.asignacionVigente(p1.id)?.asignacionMensualId).toBeNull();
    expect(tx.asignacionVigente(p2.id)?.auditorId).toBe(11);
    expect(tx.asignacionVigente(p2.id)?.asignacionMensualId).toBe(tx.asignacionesMensuales[0].id);
  });

  test('la carga cuenta una sola unidad por area mensual y no una por periodo', async () => {
    const tx = new FakeTx({ soloArea1: true });
    await prepararMes(tx);
    await guardarAsignacionMensual(tx as any, { areaId: 1, anio: 2026, mes: 9, auditorMensualId: 10, asignadoPorId: 1 });

    const vista = await obtenerVistaMensual(tx as any, 2026, 9);
    expect(vista.auditores.find((auditor) => auditor.id === 10)?.areasAsignadas).toBe(1);
    expect(vista.filas[0].periodos.p1.auditorEfectivo?.id).toBe(10);
    expect(vista.filas[0].periodos.p2.auditorEfectivo?.id).toBe(10);
  });

  test('al relacionar al auditor con un area solo se liberan sus pendientes de esa area', async () => {
    const tx = new FakeTx();
    await prepararMes(tx);
    await guardarAsignacionMensual(tx as any, { areaId: 1, anio: 2026, mes: 9, auditorMensualId: 10, asignadoPorId: 1 });
    await guardarAsignacionMensual(tx as any, { areaId: 2, anio: 2026, mes: 9, auditorMensualId: 10, asignadoPorId: 1 });
    const [p1Area1, p2Area1] = tx.objetivosDeAreaMes(1, 2026, 9);
    Object.assign(tx.asignacionVigente(p1Area1.id), {
      estado: EstadoAsignacionAuditoria.COMPLETADA,
      completadoEn: date(2026, 9, 10),
    });

    await liberarAsignacionesDeAuditorNoEjecutable(tx as any, 10, 'AUDITOR_EN_SU_PROPIA_AREA', 1);

    expect(tx.asignacionVigente(p1Area1.id)?.auditorId).toBe(10);
    expect(tx.asignacionVigente(p2Area1.id)).toBeNull();
    expect(tx.objetivosDeAreaMes(2, 2026, 9).map((objetivo) => tx.asignacionVigente(objetivo.id)?.auditorId)).toEqual([10, 10]);
  });

  test('AUDITOR a ADMINISTRADOR conserva capacidad y a SUPER_ADMIN la pierde', () => {
    expect(puedeUsuarioAuditar({ activo: true, rol: RolUsuario.AUDITOR })).toBe(true);
    expect(puedeUsuarioAuditar({ activo: true, rol: RolUsuario.ADMINISTRADOR })).toBe(true);
    expect(puedeUsuarioAuditar({ activo: true, rol: RolUsuario.SUPER_ADMIN })).toBe(false);
    expect(puedeUsuarioAuditar({ activo: false, rol: RolUsuario.AUDITOR })).toBe(false);
  });

  test('un periodo con EnvioAuditoria no cambia retroactivamente', async () => {
    const tx = new FakeTx({ soloArea1: true });
    await prepararMes(tx);
    await guardarAsignacionMensual(tx as any, { areaId: 1, anio: 2026, mes: 9, auditorMensualId: 10, asignadoPorId: 1 });
    const p1 = tx.objetivosDeAreaMes(1, 2026, 9)[0];
    p1.envioResultado = { id: 500, verificadoEn: date(2026, 9, 10), invalidadoEn: null, porcentaje: 95 };
    p1.envioResultadoId = 500;

    const resultado = await guardarAsignacionMensual(tx as any, { areaId: 1, anio: 2026, mes: 9, auditorMensualId: 11, asignadoPorId: 1 });

    expect(resultado.protegidas).toBe(1);
    expect(tx.asignacionVigente(p1.id)?.auditorId).toBe(10);
  });

  test('autoasignacion trabaja una vez por area', async () => {
    const tx = new FakeTx({ soloArea1: true });
    await prepararMes(tx);

    const resultado = await autoasignarPendientes(tx as any, 2026, 9, 1);

    expect(resultado.asignadas).toBe(1);
    expect(tx.asignacionesMensuales).toHaveLength(1);
    expect(tx.asignacionesAuditoria.filter((asignacion) => asignacion.estado !== EstadoAsignacionAuditoria.CANCELADA)).toHaveLength(2);
  });

  test('autoasignacion no selecciona responsables de su propia area', async () => {
    const tx = new FakeTx({ responsablesArea1: [1, 10], soloArea1: true });
    await prepararMes(tx);

    await autoasignarPendientes(tx as any, 2026, 9, 1);

    expect(tx.asignacionesMensuales[0].auditorId).toBe(11);
  });

  test('solo permite asegurar programacion automatica del mes actual o futuro', () => {
    const ahora = date(2026, 9, 2);

    expect(puedeAsegurarProgramacionMensual(2026, 8, ahora)).toBe(false);
    expect(puedeAsegurarProgramacionMensual(2026, 9, ahora)).toBe(true);
    expect(puedeAsegurarProgramacionMensual(2026, 10, ahora)).toBe(true);
    expect(puedeAsegurarProgramacionMensual(2027, 1, ahora)).toBe(true);
  });

  test('un mes futuro preparado genera propuesta y confirma el mismo auditor para P1 y P2', async () => {
    const tx = new FakeTx({ soloArea1: true });
    await prepararMes(tx, 2026, 10);

    const propuesta = await calcularPropuestaAutoasignacion(tx as any, 2026, 10);

    expect(propuesta.resumen).toEqual({ areas: 1, asignadas: 0, sinAuditor: 1 });
    expect(propuesta.areasPendientes).toBe(1);
    expect(propuesta.propuestas).toHaveLength(1);
    expect(propuesta.propuestas[0].auditor).not.toBeNull();

    await confirmarPropuestaAutoasignacion(tx as any, 2026, 10, [{
      areaId: 1,
      auditorId: propuesta.propuestas[0].auditor!.id,
    }], 1);

    const auditorIds = tx.objetivosDeAreaMes(1, 2026, 10)
      .map((objetivo) => tx.asignacionVigente(objetivo.id)?.auditorId);
    expect(auditorIds).toEqual([propuesta.propuestas[0].auditor!.id, propuesta.propuestas[0].auditor!.id]);
    expect((await obtenerVistaMensual(tx as any, 2026, 10)).resumen).toEqual({ areas: 1, asignadas: 1, sinAuditor: 0 });
  });

  test('un mes futuro parcialmente asignado propone el faltante sin reemplazar el periodo valido', async () => {
    const tx = new FakeTx({ soloArea1: true });
    await prepararMes(tx, 2026, 10);
    const [p1, p2] = tx.objetivosDeAreaMes(1, 2026, 10);
    await tx.asignacionAuditoria.create({
      data: {
        objetivoAuditoriaId: p1.id,
        auditorId: 10,
        asignadoPorId: 1,
        venceEn: date(2026, 10, 15),
      },
    });

    const propuesta = await calcularPropuestaAutoasignacion(tx as any, 2026, 10);
    expect(propuesta.propuestas).toHaveLength(1);

    const auditorPropuestoId = propuesta.propuestas[0].auditor!.id;
    await confirmarPropuestaAutoasignacion(tx as any, 2026, 10, [{ areaId: 1, auditorId: auditorPropuestoId }], 1);

    expect(tx.asignacionVigente(p1.id)?.auditorId).toBe(10);
    expect(tx.asignacionVigente(p2.id)?.auditorId).toBe(auditorPropuestoId);
  });

  test('P1 y P2 ya asignados se reconocen aunque falte AsignacionMensual', async () => {
    const tx = new FakeTx({ soloArea1: true });
    await prepararMes(tx, 2026, 10);
    for (const objetivo of tx.objetivosDeAreaMes(1, 2026, 10)) {
      await tx.asignacionAuditoria.create({
        data: {
          objetivoAuditoriaId: objetivo.id,
          auditorId: 10,
          asignadoPorId: 1,
          venceEn: objetivo.terminaEn,
        },
      });
    }

    const vista = await obtenerVistaMensual(tx as any, 2026, 10);
    const propuesta = await calcularPropuestaAutoasignacion(tx as any, 2026, 10);

    expect(vista.resumen).toEqual({ areas: 1, asignadas: 1, sinAuditor: 0 });
    expect(vista.filas[0].auditorMensual?.id).toBe(10);
    expect(propuesta.areasPendientes).toBe(0);
    expect(propuesta.propuestas).toHaveLength(0);
  });

  test('un mes futuro asignado no puede ejecutarse antes de su fecha de inicio', async () => {
    const tx = new FakeTx({ soloArea1: true });
    await prepararMes(tx, 2026, 10);
    const p1 = tx.objetivosDeAreaMes(1, 2026, 10)[0];

    expect(objetivoEsRealizable({ ...p1, envioResultado: null }, date(2026, 9, 2))).toBe(false);
    expect(objetivoEsRealizable({ ...p1, envioResultado: null }, date(2026, 10, 1))).toBe(true);
  });

  test('areas pendientes sin auditor elegible se reportan como sin candidato', async () => {
    const tx = new FakeTx({ responsablesArea1: [1, 10, 11], soloArea1: true });
    await prepararMes(tx, 2026, 10);

    const propuesta = await calcularPropuestaAutoasignacion(tx as any, 2026, 10);

    expect(propuesta.areasPendientes).toBe(1);
    expect(propuesta.propuestas).toHaveLength(1);
    expect(propuesta.propuestas[0].auditor).toBeNull();
    expect(propuesta.sinCandidato).toHaveLength(1);
  });

  test('area sin AsignacionMensual queda SIN_AUDITOR aunque tenga asignacion historica', async () => {
    const tx = new FakeTx({ soloArea1: true });
    await prepararMes(tx);
    const p1 = tx.objetivosDeAreaMes(1, 2026, 9)[0];
    await tx.asignacionAuditoria.create({
      data: {
        objetivoAuditoriaId: p1.id,
        auditorId: 10,
        asignadoPorId: 1,
        venceEn: date(2026, 9, 15),
      },
    });

    const vista = await obtenerVistaMensual(tx as any, 2026, 9);

    expect(vista.filas[0].estado).toBe('SIN_AUDITOR');
    expect(vista.filas[0].auditorMensual).toBeNull();
  });

  test('reabrir conserva inicialmente el auditor de la asignacion', async () => {
    const tx = new FakeTx({ soloArea1: true });
    await prepararMes(tx, 2026, 1);
    const p2 = tx.objetivosDeAreaMes(1, 2026, 1)[1];
    const asignacion = await tx.asignacionAuditoria.create({
      data: {
        objetivoAuditoriaId: p2.id,
        auditorId: 10,
        asignadoPorId: 1,
        estado: EstadoAsignacionAuditoria.VENCIDA,
        venceEn: date(2026, 2, 6),
      },
    });

    const reabierta = await reabrirAsignacionEnTransaccion(tx as any, asignacion.id, {
      motivo: 'Revision tardia',
      reabiertaHasta: date(2099, 1, 1),
    }, 1);

    expect(reabierta.auditorId).toBe(10);
    expect(reabierta.estado).toBe(EstadoAsignacionAuditoria.PENDIENTE);
  });

  test('octubre es independiente de septiembre', async () => {
    const tx = new FakeTx({ soloArea1: true });
    await prepararMes(tx, 2026, 9);
    await prepararMes(tx, 2026, 10);

    await guardarAsignacionMensual(tx as any, { areaId: 1, anio: 2026, mes: 9, auditorMensualId: 10, asignadoPorId: 1 });
    await guardarAsignacionMensual(tx as any, { areaId: 1, anio: 2026, mes: 10, auditorMensualId: 11, asignadoPorId: 1 });

    expect(tx.asignacionesMensuales.find((asignacion) => asignacion.mes === 9)?.auditorId).toBe(10);
    expect(tx.asignacionesMensuales.find((asignacion) => asignacion.mes === 10)?.auditorId).toBe(11);
  });

  test('contexto de auditoria autoriza por AsignacionAuditoria.auditorId', () => {
    expect(puedeUsarAsignacionEjecutable({ usuarioId: 10, rol: RolUsuario.AUDITOR }, 10)).toBe(true);
    expect(puedeUsarAsignacionEjecutable({ usuarioId: 11, rol: RolUsuario.AUDITOR }, 10)).toBe(false);
    expect(puedeUsarAsignacionEjecutable({ usuarioId: 1, rol: RolUsuario.ADMINISTRADOR }, 10)).toBe(true);
  });
});
