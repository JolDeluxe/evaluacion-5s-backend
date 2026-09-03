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

  $executeRaw = async () => 1;

  usuario = {
    findMany: async ({ where }: any) => this.usuarios
      .filter((usuario) => usuario.activo === where.activo && where.rol.in.includes(usuario.rol))
      .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')),
    findUnique: async ({ where }: any) => this.usuarios.find((u) => u.id === where.id) ?? null,
    findUniqueOrThrow: async ({ where }: any) => {
      const usuario = this.usuarios.find((actual) => actual.id === where.id);
      if (!usuario) throw new Error('Usuario no encontrado');
      return usuario;
    },
  };

  enlaceInvitado = {
    updateMany: async () => ({ count: 0 }),
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
    findUnique: async ({ where }: any) => {
      if (where?.areaId_anio_mes) {
        const key = where.areaId_anio_mes;
        const asignacion = this.asignacionesMensuales.find((actual) => (
          actual.areaId === key.areaId && actual.anio === key.anio && actual.mes === key.mes
        ));
        if (!asignacion) return null;
        return {
          ...asignacion,
          auditor: this.usuarios.find((u) => u.id === asignacion.auditorId),
        };
      }
      return null;
    },
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
    findMany: async ({ where = {} }: any) => this.asignacionesAuditoria
      .filter((asignacion) => {
        if (where.objetivoAuditoriaId && asignacion.objetivoAuditoriaId !== where.objetivoAuditoriaId) return false;
        if (where.auditorId && asignacion.auditorId !== where.auditorId) return false;
        if (where.estado?.not && asignacion.estado === where.estado.not) return false;
        if (where.objetivoAuditoria?.areaId) {
          const obj = this.objetivos.find((o) => o.id === asignacion.objetivoAuditoriaId);
          if (obj?.areaId !== where.objetivoAuditoria.areaId) return false;
        }
        return true;
      })
      .map((asignacion) => ({
        ...asignacion,
        auditor: this.usuarios.find((u) => u.id === asignacion.auditorId),
        objetivoAuditoria: this.decorateObjetivo(
          this.objetivos.find((o) => o.id === asignacion.objetivoAuditoriaId),
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
    await guardarAsignacionMensual(tx as any, { areaId: 1, anio: 2026, mes: 1, auditorMensualId: 10, asignadoPorId: 1 });

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

  test('reabrir P1 vencida de Joel sin AsignacionMensual responde con CONFLICTO y NO crea asignación ni se le asigna a Joel', async () => {
    const tx = new FakeTx({ soloArea1: true });
    await prepararMes(tx, 2026, 8);
    const p1 = tx.objetivos.find((o) => o.periodo === 1);

    // Existe asignación histórica/vencida de Joel (10) pero NO existe AsignacionMensual
    const asignacionJoel = await tx.asignacionAuditoria.create({
      data: {
        objetivoAuditoriaId: p1.id,
        auditorId: 10,
        asignadoPorId: 1,
        estado: EstadoAsignacionAuditoria.VENCIDA,
        venceEn: new Date(2026, 7, 15),
      },
    });

    // Intentar reabrir sin que exista AsignacionMensual
    expect(reabrirAsignacionEnTransaccion(tx as any, asignacionJoel.id, {
      motivo: 'Intento de reapertura sin auditor mensual',
    }, 1)).rejects.toThrow('primero necesitas asignar un auditor mensual al área');

    // Confirmar que NO se creó ninguna asignación ejecutable activa para Joel
    const asignacionesVigentes = tx.asignacionesAuditoria.filter((a) => a.objetivoAuditoriaId === p1.id && a.estado === 'PENDIENTE');
    expect(asignacionesVigentes.length).toBe(0);
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

  describe('Sincronización Automática de Asignación Mensual', () => {

    test('1. P1 vencida sin AsignacionAuditoria + P2 pendiente + nuevo auditor Fernando -> P1 NO se reabre automáticamente; P2 Fernando pendiente', async () => {
      const tx = new FakeTx({ soloArea1: true });
      await asegurarProgramacionMensual(tx as any, 2026, 8, 1);

      const p1 = tx.objetivos.find((o) => o.periodo === 1);
      const p2 = tx.objetivos.find((o) => o.periodo === 2);

      p1.terminaEn = new Date(2026, 7, 10);

      await guardarAsignacionMensual(tx as any, {
        areaId: 1,
        anio: 2026,
        mes: 8,
        auditorMensualId: 11,
        asignadoPorId: 1,
      });

      const asigP1 = tx.asignacionesAuditoria.find((a) => a.objetivoAuditoriaId === p1.id && a.estado !== 'CANCELADA');
      const asigP2 = tx.asignacionesAuditoria.find((a) => a.objetivoAuditoriaId === p2.id && a.estado !== 'CANCELADA');

      // P1 vencida NO debe recibir una AsignacionAuditoria ejecutable reabierta automáticamente
      expect(asigP1).toBeUndefined();
      expect(asigP2.auditorId).toBe(11);
      expect(asigP2.estado).toBe('PENDIENTE');
    });

    test('2. P1 Joel COMPLETADA + P2 Joel pendiente + mensual cambia a Andrea -> P1 Joel intacta, P2 Andrea', async () => {
      const tx = new FakeTx({ soloArea1: true });
      await asegurarProgramacionMensual(tx as any, 2026, 8, 1);
      const p1 = tx.objetivos.find((o) => o.periodo === 1);
      p1.terminaEn = date(2099, 1, 1);
      await guardarAsignacionMensual(tx as any, { areaId: 1, anio: 2026, mes: 8, auditorMensualId: 10, asignadoPorId: 1 });

      const asigP1 = tx.asignacionesAuditoria.find((a) => a.objetivoAuditoriaId === p1.id);
      asigP1.estado = 'COMPLETADA';
      asigP1.completadoEn = new Date();

      await guardarAsignacionMensual(tx as any, { areaId: 1, anio: 2026, mes: 8, auditorMensualId: 11, asignadoPorId: 1 });

      expect(asigP1.auditorId).toBe(10);
      expect(asigP1.estado).toBe('COMPLETADA');

      const p2 = tx.objetivos.find((o) => o.periodo === 2);
      const asigP2 = tx.asignacionesAuditoria.find((a) => a.objetivoAuditoriaId === p2.id && a.estado !== 'CANCELADA');
      expect(asigP2.auditorId).toBe(11);
    });

    test('3. P1 Joel vencida + P2 Joel pendiente + mensual cambia a Fernando -> Joel cancelado, P1 permanece cerrada (NO reabierta), P2 Fernando', async () => {
      const tx = new FakeTx({ soloArea1: true });
      await asegurarProgramacionMensual(tx as any, 2026, 8, 1);
      const p1 = tx.objetivos.find((o) => o.periodo === 1);
      p1.terminaEn = date(2099, 1, 1);
      await guardarAsignacionMensual(tx as any, { areaId: 1, anio: 2026, mes: 8, auditorMensualId: 10, asignadoPorId: 1 });

      p1.terminaEn = new Date(2026, 7, 10);
      const asigP1Joel = tx.asignacionesAuditoria.find((a) => a.objetivoAuditoriaId === p1.id);
      asigP1Joel.estado = 'VENCIDA';

      await guardarAsignacionMensual(tx as any, { areaId: 1, anio: 2026, mes: 8, auditorMensualId: 11, asignadoPorId: 1 });

      expect(asigP1Joel.estado).toBe('CANCELADA');
      const asigP1Fernando = tx.asignacionesAuditoria.find((a) => a.objetivoAuditoriaId === p1.id && a.estado === 'PENDIENTE');
      // P1 NO se reabre en automático
      expect(asigP1Fernando).toBeUndefined();

      // Si el administrador reabre explícitamente P1 después:
      const reabierta = await reabrirAsignacionEnTransaccion(tx as any, null, {
        motivo: 'Reapertura explícita del administrador',
        objetivoAuditoriaId: p1.id,
      }, 1);

      expect(reabierta.auditorId).toBe(11);
      expect(reabierta.estado).toBe('PENDIENTE');
      expect(reabierta.reabiertaHasta).toBeDefined();
    });

    test('4. OCC: Guardar con expectedAuditorId desactualizado responde con conflicto (409)', async () => {
      const tx = new FakeTx({ soloArea1: true });
      await asegurarProgramacionMensual(tx as any, 2026, 8, 1);
      await guardarAsignacionMensual(tx as any, { areaId: 1, anio: 2026, mes: 8, auditorMensualId: 10, asignadoPorId: 1 });

      // Admin B cambia a Andrea (11)
      await guardarAsignacionMensual(tx as any, { areaId: 1, anio: 2026, mes: 8, auditorMensualId: 11, asignadoPorId: 1 });

      // Admin A intenta guardar con expectedAuditorId = 10 (Joel)
      expect(guardarAsignacionMensual(tx as any, {
        areaId: 1,
        anio: 2026,
        mes: 8,
        auditorMensualId: 12,
        expectedAuditorId: 10,
        asignadoPorId: 1,
      })).rejects.toThrow('modificada por otro administrador');
    });

    test('5. OCC cuando el área estaba SIN AUDITOR: expectedAuditorId = null detecta asignación intermedia de otro admin (409)', async () => {
      const tx = new FakeTx({ soloArea1: true });
      await asegurarProgramacionMensual(tx as any, 2026, 8, 1);

      // Admin B asigna a Pedro (11) partiendo de Sin Auditor
      await guardarAsignacionMensual(tx as any, {
        areaId: 1,
        anio: 2026,
        mes: 8,
        auditorMensualId: 11,
        expectedAuditorId: null,
        asignadoPorId: 1,
      });

      // Admin A intenta guardar asignando a Juan (10) enviando su snapshot viejo (expectedAuditorId = null)
      expect(guardarAsignacionMensual(tx as any, {
        areaId: 1,
        anio: 2026,
        mes: 8,
        auditorMensualId: 10,
        expectedAuditorId: null,
        asignadoPorId: 1,
      })).rejects.toThrow('modificada por otro administrador');
    });

    test('6. Guardar el mismo auditor dos veces -> no duplicados', async () => {
      const tx = new FakeTx({ soloArea1: true });
      await asegurarProgramacionMensual(tx as any, 2026, 8, 1);
      await guardarAsignacionMensual(tx as any, { areaId: 1, anio: 2026, mes: 8, auditorMensualId: 10, asignadoPorId: 1 });

      const iniciales = tx.asignacionesAuditoria.length;
      await guardarAsignacionMensual(tx as any, { areaId: 1, anio: 2026, mes: 8, auditorMensualId: 10, asignadoPorId: 1 });
      const finales = tx.asignacionesAuditoria.length;

      expect(finales).toBe(iniciales);
    });

    test('7. GET / obtenerVistaMensual es 100% LECTURA (repetir 10 veces no modifica BD ni crea asignaciones)', async () => {
      const tx = new FakeTx({ soloArea1: true });
      await asegurarProgramacionMensual(tx as any, 2026, 8, 1);

      const asignacionesAuditoriaIniciales = [...tx.asignacionesAuditoria];
      const asignacionesMensualesIniciales = [...tx.asignacionesMensuales];

      for (let i = 0; i < 10; i++) {
        await obtenerVistaMensual(tx as any, 2026, 8);
      }

      expect(tx.asignacionesAuditoria).toEqual(asignacionesAuditoriaIniciales);
      expect(tx.asignacionesMensuales).toEqual(asignacionesMensualesIniciales);
    });

    test('CASO A: P1 vencida Joel + P2 pendiente Joel + Sin AsignacionMensual -> Reabrir seleccionando Daniela crea AsignacionMensual Daniela, reabre P1 Daniela y pasa P2 Daniela', async () => {
      const tx = new FakeTx({ soloArea1: true });
      await asegurarProgramacionMensual(tx as any, 2026, 8, 1);
      const p1 = tx.objetivos.find((o) => o.periodo === 1);
      const p2 = tx.objetivos.find((o) => o.periodo === 2);

      // Asignación inicial P1 vencida de Joel (10) y P2 pendiente de Joel (10) sin AsignacionMensual
      p1.terminaEn = new Date(2026, 7, 10);
      const asigP1Joel = await tx.asignacionAuditoria.create({
        data: { objetivoAuditoriaId: p1.id, auditorId: 10, asignadoPorId: 1, estado: 'VENCIDA', venceEn: new Date(2026, 7, 10) },
      });
      await tx.asignacionAuditoria.create({
        data: { objetivoAuditoriaId: p2.id, auditorId: 10, asignadoPorId: 1, estado: 'PENDIENTE', venceEn: new Date(2026, 7, 25) },
      });

      // Admin pulsa Reabrir P1 seleccionando Daniela (11)
      const reabierta = await reabrirAsignacionEnTransaccion(tx as any, asigP1Joel.id, {
        motivo: 'Asignar y reabrir P1',
        auditorMensualId: 11,
        expectedAuditorId: null,
      }, 1);

      // AsignacionMensual debe ser Daniela (11)
      const mensual = tx.asignacionesMensuales.find((m) => m.areaId === 1 && m.anio === 2026 && m.mes === 8);
      expect(mensual.auditorId).toBe(11);

      // P1 reabierta para Daniela (11)
      expect(reabierta.auditorId).toBe(11);
      expect(reabierta.estado).toBe('PENDIENTE');

      // P2 pendiente pasa a Daniela (11)
      const asigP2Daniela = tx.asignacionesAuditoria.find((a) => a.objetivoAuditoriaId === p2.id && a.estado === 'PENDIENTE');
      expect(asigP2Daniela.auditorId).toBe(11);

      // P1 Joel permanece histórico
      expect(asigP1Joel.estado).toBe('CANCELADA');
    });

    test('CASO B: Reabrir sin auditor con expectedAuditorId = null detecta asignación intermedia de otro admin (409)', async () => {
      const tx = new FakeTx({ soloArea1: true });
      await asegurarProgramacionMensual(tx as any, 2026, 8, 1);
      const p1 = tx.objetivos.find((o) => o.periodo === 1);
      p1.terminaEn = new Date(2026, 7, 10);
      const asigP1Joel = await tx.asignacionAuditoria.create({
        data: { objetivoAuditoriaId: p1.id, auditorId: 10, asignadoPorId: 1, estado: 'VENCIDA', venceEn: new Date(2026, 7, 10) },
      });

      // Admin B asigna a Pedro (11) como auditor mensual en segundo plano
      await guardarAsignacionMensual(tx as any, { areaId: 1, anio: 2026, mes: 8, auditorMensualId: 11, asignadoPorId: 1 });

      // Admin A con snapshot viejo (expectedAuditorId = null) intenta asignar Juan (10) y reabrir
      expect(reabrirAsignacionEnTransaccion(tx as any, asigP1Joel.id, {
        motivo: 'Intento desactualizado',
        auditorMensualId: 10,
        expectedAuditorId: null,
      }, 1)).rejects.toThrow('modificada por otro administrador');

      // Pedro se mantiene como auditor mensual
      const mensual = tx.asignacionesMensuales.find((m) => m.areaId === 1 && m.anio === 2026 && m.mes === 8);
      expect(mensual.auditorId).toBe(11);
    });

    test('CASO C: Auditor seleccionado inválido produce rollback completo (no mensual, no reapertura)', async () => {
      const tx = new FakeTx({ soloArea1: true });
      tx.usuarioArea.findFirst = async () => ({ id: 99 } as any); // El auditor es responsable de su propia área

      const p1 = { id: 100, areaId: 1, anio: 2026, mes: 8, periodo: 1, iniciaEn: new Date(2026, 7, 1), terminaEn: new Date(2026, 7, 10), envioResultado: null, enviosAuditoria: [], asignacionesAuditoria: [] };
      tx.objetivos.push(p1 as any);
      const asigP1 = await tx.asignacionAuditoria.create({
        data: { objetivoAuditoriaId: p1.id, auditorId: 10, asignadoPorId: 1, estado: 'VENCIDA', venceEn: new Date(2026, 7, 10) },
      });

      const inicialesMensuales = tx.asignacionesMensuales.length;

      // Intentar reabrir asignando a auditor que pertenece a la misma área
      await expect(reabrirAsignacionEnTransaccion(tx as any, asigP1.id, {
        motivo: 'Auditor invalido pertenencia area',
        auditorMensualId: 10,
        expectedAuditorId: null,
      }, 1)).rejects.toThrow('no puede');

      // No se creó AsignacionMensual
      expect(tx.asignacionesMensuales.length).toBe(inicialesMensuales);
    });

    test('CASO D: Daniela ya es auditor mensual -> Reabrir P1 no requiere selector y reabre para Daniela', async () => {
      const tx = new FakeTx({ soloArea1: true });
      await asegurarProgramacionMensual(tx as any, 2026, 8, 1);
      await guardarAsignacionMensual(tx as any, { areaId: 1, anio: 2026, mes: 8, auditorMensualId: 11, asignadoPorId: 1 });
      const p1 = tx.objetivos.find((o) => o.periodo === 1);
      p1.terminaEn = new Date(2026, 7, 10);
      const asigP1 = await tx.asignacionAuditoria.create({
        data: { objetivoAuditoriaId: p1.id, auditorId: 10, asignadoPorId: 1, estado: 'VENCIDA', venceEn: new Date(2026, 7, 10) },
      });

      const reabierta = await reabrirAsignacionEnTransaccion(tx as any, asigP1.id, {
        motivo: 'Reapertura normal',
        expectedAuditorId: 11,
      }, 1);

      expect(reabierta.auditorId).toBe(11);
      expect(reabierta.estado).toBe('PENDIENTE');
    });

    test('SEGUNDO ESCENARIO: Joel activo -> cambio mensual a Daniela mantiene P1 cerrada y cancela P2 Joel; reapertura posterior asigna Daniela', async () => {
      const tx = new FakeTx({ soloArea1: true });
      await asegurarProgramacionMensual(tx as any, 2026, 8, 1);

      const p1 = tx.objetivos.find((o) => o.periodo === 1);
      const p2 = tx.objetivos.find((o) => o.periodo === 2);
      p1.terminaEn = new Date(2099, 1, 1);
      await guardarAsignacionMensual(tx as any, { areaId: 1, anio: 2026, mes: 8, auditorMensualId: 10, asignadoPorId: 1 });

      p1.terminaEn = new Date(2026, 7, 10);
      const asigP1Joel = tx.asignacionesAuditoria.find((a) => a.objetivoAuditoriaId === p1.id);
      asigP1Joel.estado = 'VENCIDA';

      // Cambiar normalmente auditor mensual Joel (10) -> Daniela (11)
      await guardarAsignacionMensual(tx as any, { areaId: 1, anio: 2026, mes: 8, auditorMensualId: 11, expectedAuditorId: 10, asignadoPorId: 1 });

      // P1 Joel cancelada/cerrada (no reabierta automáticamente). No existe P1 para Daniela todavía.
      expect(asigP1Joel.estado).toBe('CANCELADA');
      const p1DanielaAuto = tx.asignacionesAuditoria.find((a) => a.objetivoAuditoriaId === p1.id && a.estado === 'PENDIENTE');
      expect(p1DanielaAuto).toBeUndefined();

      // P2 Joel cancelada. P2 Daniela pendiente.
      const p2Daniela = tx.asignacionesAuditoria.find((a) => a.objetivoAuditoriaId === p2.id && a.estado === 'PENDIENTE');
      expect(p2Daniela.auditorId).toBe(11);

      // Reabrir explícitamente P1 posteriormente: toma a Daniela (11) desde AsignacionMensual
      const reabiertaP1 = await reabrirAsignacionEnTransaccion(tx as any, asigP1Joel.id, {
        motivo: 'Reapertura posterior por admin',
        expectedAuditorId: 11,
      }, 1);

      expect(reabiertaP1.auditorId).toBe(11);
      expect(reabiertaP1.estado).toBe('PENDIENTE');
    });
  });
});
