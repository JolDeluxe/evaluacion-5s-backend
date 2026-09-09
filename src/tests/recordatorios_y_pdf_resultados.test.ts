/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from 'bun:test';
import {
  evaluarVentanaRecordatorioPeriodo,
  obtenerFechaHoraCDMX,
  obtenerUltimoDiaHabilPeriodo,
} from '../utils/periodos';
import { renderPeriodReminder } from '../modules/notificaciones/templates/period_reminder';
import { renderMonthlyResults } from '../modules/notificaciones/templates/monthly_results';
import { resolverTemplate } from '../modules/notificaciones/templates';
import {
  generarPdfResultadosGeneral,
  mapAreasConRankingCanonico,
} from '../modules/notificaciones/reportes/pdf-resultados';

describe('Recordatorios de Periodo (P1 y P2) - Reglas de Fechas Hábiles y Ventana CDMX', () => {
  it('P1: calcula el último día hábil <= día 15 (caso domingo -> viernes 13)', () => {
    // Febrero 2026: el 15 es domingo. Último día hábil <= 15 es el viernes 13
    const fecha = obtenerUltimoDiaHabilPeriodo(2026, 2, 1);
    expect(fecha.getFullYear()).toBe(2026);
    expect(fecha.getMonth() + 1).toBe(2);
    expect(fecha.getDate()).toBe(13);
    expect(fecha.getDay()).toBe(5); // Viernes
  });

  it('P1: calcula el último día hábil <= día 15 (caso sábado -> viernes 14)', () => {
    // Agosto 2026: el 15 es sábado. Último día hábil <= 15 es el viernes 14
    const fecha = obtenerUltimoDiaHabilPeriodo(2026, 8, 1);
    expect(fecha.getFullYear()).toBe(2026);
    expect(fecha.getMonth() + 1).toBe(8);
    expect(fecha.getDate()).toBe(14);
    expect(fecha.getDay()).toBe(5); // Viernes
  });

  it('P1: calcula el último día hábil <= día 15 (caso día hábil exacto -> 15)', () => {
    // Julio 2026: el 15 es miércoles. Último día hábil es el 15
    const fecha = obtenerUltimoDiaHabilPeriodo(2026, 7, 1);
    expect(fecha.getDate()).toBe(15);
    expect(fecha.getDay()).toBe(3); // Miércoles
  });

  it('P2: calcula el último día hábil <= fin de mes (caso domingo -> viernes 29)', () => {
    // Mayo 2026: el 31 es domingo. Último día hábil es el viernes 29
    const fecha = obtenerUltimoDiaHabilPeriodo(2026, 5, 2);
    expect(fecha.getFullYear()).toBe(2026);
    expect(fecha.getMonth() + 1).toBe(5);
    expect(fecha.getDate()).toBe(29);
    expect(fecha.getDay()).toBe(5); // Viernes
  });

  it('P2: calcula el último día hábil <= fin de mes (caso sábado -> viernes 30)', () => {
    // Octubre 2026: el 31 es sábado. Último día hábil es el viernes 30
    const fecha = obtenerUltimoDiaHabilPeriodo(2026, 10, 2);
    expect(fecha.getFullYear()).toBe(2026);
    expect(fecha.getMonth() + 1).toBe(10);
    expect(fecha.getDate()).toBe(30);
    expect(fecha.getDay()).toBe(5); // Viernes
  });

  it('P2: calcula el último día hábil <= fin de mes (caso día hábil exacto -> 30 o 31)', () => {
    // Septiembre 2026: el 30 es miércoles. Último día hábil es el 30
    const fecha = obtenerUltimoDiaHabilPeriodo(2026, 9, 2);
    expect(fecha.getDate()).toBe(30);
    expect(fecha.getDay()).toBe(3); // Miércoles
  });

  it('Ventana CDMX: no es elegible si aún no llega la fecha del recordatorio', () => {
    const fechaRecordatorio = new Date(2026, 8, 14); // 14 de Septiembre
    // Evaluamos con fecha 10 de Septiembre
    const ahora = new Date('2026-09-10T15:00:00Z');
    const resultado = evaluarVentanaRecordatorioPeriodo(fechaRecordatorio, ahora);

    expect(resultado.esElegible).toBe(false);
    expect(resultado.esObsoleto).toBe(false);
  });

  it('Ventana CDMX: se considera OBSOLETO si la fecha ya pasó (no se envían recordatorios extemporáneos)', () => {
    const fechaRecordatorio = new Date(2026, 8, 14); // 14 de Septiembre
    // Evaluamos con fecha 16 de Septiembre
    const ahora = new Date('2026-09-16T15:00:00Z');
    const resultado = evaluarVentanaRecordatorioPeriodo(fechaRecordatorio, ahora);

    expect(resultado.esElegible).toBe(false);
    expect(resultado.esObsoleto).toBe(true);
    expect(resultado.motivo).toContain('ya pasó');
  });

  it('Ventana CDMX: no es elegible el mismo día antes de las 09:00 AM CDMX', () => {
    const fechaRecordatorio = new Date(2026, 8, 15);
    // 08:00 AM hora México (en verano UTC-6: 14:00 UTC)
    const ahora = new Date('2026-09-15T14:00:00Z');
    const cdmx = obtenerFechaHoraCDMX(ahora);
    expect(cdmx.hora).toBe(8);

    const resultado = evaluarVentanaRecordatorioPeriodo(fechaRecordatorio, ahora);
    expect(resultado.esElegible).toBe(false);
    expect(resultado.motivo).toContain('09:00 AM');
  });

  it('Ventana CDMX: ES ELEGIBLE el mismo día a partir de las 09:00 AM CDMX', () => {
    const fechaRecordatorio = new Date(2026, 8, 15);
    // 10:00 AM hora México (en verano UTC-6: 16:00 UTC)
    const ahora = new Date('2026-09-15T16:00:00Z');
    const cdmx = obtenerFechaHoraCDMX(ahora);
    expect(cdmx.hora).toBe(10);

    const resultado = evaluarVentanaRecordatorioPeriodo(fechaRecordatorio, ahora);
    expect(resultado.esElegible).toBe(true);
    expect(resultado.esObsoleto).toBe(false);
  });
});

describe('Templates Institucionales y Consistencia Visual Cuadra', () => {
  it('renderPeriodReminder: compila asunto, áreas, logo CID, QR y texto alternativo', () => {
    const render = renderPeriodReminder({
      templateName: 'period_reminder',
      templateVersion: 'v1',
      auditorNombre: 'Joel Isaac Rodríguez',
      periodo: 1,
      mes: '2026-09',
      mesEtiqueta: 'Septiembre 2026',
      fechaLimite: '14 de Septiembre de 2026',
      areas: ['Montado Bota', 'Corte Manual'],
      urlMisAuditorias: 'http://localhost:5173/mis-auditorias',
    });

    expect(render.subject).toBe('Recordatorio: Auditorías pendientes Periodo 1 — Septiembre 2026');
    expect(render.html).toContain('cid:logo-cuadra');
    expect(render.html).toContain('cid:qr-code');
    expect(render.html).toContain('Joel Isaac Rodríguez');
    expect(render.html).toContain('Montado Bota');
    expect(render.html).toContain('Corte Manual');
    expect(render.html).toContain('14 de Septiembre de 2026');
    expect(render.html).toContain('Completar Auditorías');
    expect(render.qrUrl).toBe('http://localhost:5173/mis-auditorias');

    // Texto plano
    expect(render.text).toContain('RECORDATORIO: AUDITORÍAS PENDIENTES (PERIODO 1 — Septiembre 2026)');
    expect(render.text).toContain('Joel Isaac Rodríguez');
    expect(render.text).toContain('Montado Bota');
  });

  it('renderMonthlyResults: compila con identidad visual aprobada de Cuadra, logo CID y tarjeta sobria', () => {
    const render = renderMonthlyResults({
      templateName: 'monthly_results',
      templateVersion: 'v1',
      destinatarioNombre: 'Laura Hernández',
      mes: '2026-09',
      mesEtiqueta: 'Septiembre 2026',
      resultadoGeneral: 94.5,
      areas: [
        { nombre: 'Almacén General', resultado: 98.2 },
        { nombre: 'Bordado Especial', resultado: 68.0 },
      ],
      urlResultados: 'http://localhost:5173/resultados/general?tipo=mes&mes=2026-09',
    });

    expect(render.subject).toBe('Resultados 5S — Septiembre 2026');
    expect(render.html).toContain('cid:logo-cuadra');
    expect(render.html).toContain('cid:qr-code');
    expect(render.html).toContain('Laura Hernández');
    expect(render.html).toContain('94.5%');
    expect(render.html).toContain('Almacén General');
    expect(render.html).toContain('98.2%');
    expect(render.html).toContain('Bordado Especial');
    expect(render.html).toContain('68.0%');
    expect(render.html).toContain('Resultados Generales 5S');
    expect(render.html).toContain('Áreas bajo tu responsabilidad');
    expect(render.html).toContain('VER RESULTADOS');
    expect(render.html).toContain('DESCARGAR PDF');

    // Confirmar presencia de colores visuales de semáforo inline
    expect(render.html).toContain('#15803d'); // Verde para 94.5% y 98.2%
    expect(render.html).toContain('#dcfce7'); // Fondo verde suave
    expect(render.html).toContain('#c2410c'); // Naranja para 68.0%
    expect(render.html).toContain('#ffedd5'); // Fondo naranja suave

    // Confirmar que no hay etiquetas interpretativas ni textos robóticos
    expect(render.html).not.toContain('Excelente');
    expect(render.html).not.toContain('Satisfactorio');
    expect(render.html).not.toContain('Crítico');
    expect(render.html).not.toContain('>Nivel<');
    expect(render.html).not.toContain('Promedio general de la organización');

    expect(render.text).toContain('Resultados Generales 5S: 94.5%');
    expect(render.text).toContain('Áreas bajo tu responsabilidad');
    expect(render.text).not.toContain('Excelente');
    expect(render.text).not.toContain('Promedio general de la organización');
    expect(render.text).toContain('Para consultar el detalle interactivo');
    expect(render.text).toContain('Para descargar una copia del reporte oficial en PDF');
  });

  it('renderMonthlyResults: para resultado nulo (—) NO aplica color de semáforo', () => {
    const render = renderMonthlyResults({
      templateName: 'monthly_results',
      templateVersion: 'v1',
      destinatarioNombre: 'Auditor Sin Datos',
      mes: '2026-09',
      mesEtiqueta: 'Septiembre 2026',
      resultadoGeneral: null,
      areas: [
        { nombre: 'Área En Curso', resultado: null },
      ],
      urlResultados: 'http://localhost:5173/resultados/general?tipo=mes&mes=2026-09',
      urlDescargaPdf: 'http://localhost:5173/resultados/descargar?tipo=mes&mes=2026-09',
    });

    expect(render.html).toContain('—');
    // Para null no debe haber fondo de semáforo verde/rojo/etc.
    expect(render.html).not.toContain('#dcfce7');
    expect(render.html).not.toContain('#fee2e2');
    expect(render.html).toContain('#71717a'); // Color neutro para general null
    expect(render.html).toContain('#a1a1aa'); // Color neutro para fila área null

    // Confirmar que el botón VER RESULTADOS y DESCARGAR PDF están desacoplados
    expect(render.html).toContain('href="http://localhost:5173/resultados/general?tipo=mes&mes=2026-09"');
    expect(render.html).toContain('href="http://localhost:5173/resultados/descargar?tipo=mes&mes=2026-09"');
    expect(render.html).not.toContain('&amp;descargar=pdf');
    expect(render.html).not.toContain('&descargar=pdf');
  });

  it('resolverTemplate: resuelve dinámicamente period_reminder y monthly_results', () => {
    const resReminder = resolverTemplate({
      templateName: 'period_reminder',
      templateVersion: 'v1',
      auditorNombre: 'Carlos',
      periodo: 2,
      mes: '2026-09',
      mesEtiqueta: 'Septiembre 2026',
      fechaLimite: '30 de Septiembre de 2026',
      areas: ['Troquelado'],
      urlMisAuditorias: 'http://localhost/mis-auditorias',
    });

    expect(resReminder).not.toBeNull();
    expect(resReminder?.subject).toContain('Periodo 2');

    const resResults = resolverTemplate({
      templateName: 'monthly_results',
      templateVersion: 'v1',
      destinatarioNombre: 'Carlos',
      mes: '2026-09',
      mesEtiqueta: 'Septiembre 2026',
      areas: [],
      resultadoGeneral: 85,
      urlResultados: 'http://localhost/resultados',
    });

    expect(resResults).not.toBeNull();
    expect(resResults?.subject).toContain('Resultados 5S');
  });
});

describe('Reportes Server-Side y Numeración Consecutiva de Áreas (1, 2, 3...)', () => {
  it('mapAreasConRankingCanonico: asigna numeración consecutiva limpia a las áreas calificadas', () => {
    const areasInput = [
      { area: { id: 1, nombre: 'Area 1' }, resultadoMensual: 98.5 },
      { area: { id: 2, nombre: 'Area 2' }, resultadoMensual: 95.0 },
      { area: { id: 3, nombre: 'Area 3' }, resultadoMensual: 95.0 },
      { area: { id: 4, nombre: 'Area 4' }, resultadoMensual: 92.0 },
      { area: { id: 5, nombre: 'Area 5' }, resultadoMensual: null }, // Sin calificar -> null
    ];

    const ranked = mapAreasConRankingCanonico(areasInput);

    expect(ranked[0].posicion).toBe(1);
    expect(ranked[1].posicion).toBe(2);
    expect(ranked[2].posicion).toBe(3);
    expect(ranked[3].posicion).toBe(4);
    expect(ranked[4].posicion).toBeNull();
  });

  it('generarPdfResultadosGeneral: genera un Buffer PDF válido y no vacío', async () => {
    const datosMock = {
      mes: { clave: '2026-09', etiqueta: 'Septiembre 2026' },
      resultadoGeneral: 91.2,
      ganadoresPorTipo: {
        administrativo: {
          resultado: 98.5,
          areas: [{ id: 10, nombre: 'Dirección General' }],
        },
        operativo: {
          resultado: 96.0,
          areas: [{ id: 20, nombre: 'Pespunte Fino' }],
        },
      },
      areas: [
        {
          area: { id: 1, nombre: 'Dirección General', tipo: 'ADMINISTRATIVA' as const },
          periodos: [
            { periodo: 1, porcentaje: 98.0 },
            { periodo: 2, porcentaje: 99.0 },
          ],
          resultadoMensual: 98.5,
        },
        {
          area: { id: 2, nombre: 'Pespunte Fino', tipo: 'OPERATIVA' as const },
          periodos: [
            { periodo: 1, porcentaje: 96.0 },
            { periodo: 2, porcentaje: 96.0 },
          ],
          resultadoMensual: 96.0,
        },
      ],
    };

    const bufferPdf = await generarPdfResultadosGeneral(datosMock, 'Septiembre 2026');

    expect(Buffer.isBuffer(bufferPdf)).toBe(true);
    expect(bufferPdf.length).toBeGreaterThan(1000);
    // Verificar firma binaria del archivo PDF (%PDF)
    const header = bufferPdf.slice(0, 5).toString('ascii');
    expect(header.startsWith('%PDF-')).toBe(true);

    // Verificar que la leyenda 'ESCALA DE EVALUACIÓN' fue eliminada del documento
    const contenidoTexto = Buffer.from(bufferPdf.filter((b) => b !== 0)).toString('latin1');
    expect(contenidoTexto.toUpperCase()).not.toContain('ESCALA DE EVALUACIÓN');
    expect(contenidoTexto.toUpperCase()).not.toContain('ESCALA DE EVALUACION');

    // Confirmar que no hay clasificaciones textuales en el PDF
    expect(contenidoTexto.toUpperCase()).not.toContain('EXCELENTE');
    expect(contenidoTexto.toUpperCase()).not.toContain('SATISFACTORIO');
    expect(contenidoTexto.toUpperCase()).not.toContain('CRÍTICO');
    expect(contenidoTexto.toUpperCase()).not.toContain('CRITICO');
    expect(contenidoTexto.toUpperCase()).not.toContain('PROMEDIO GENERAL');
    expect(contenidoTexto.toUpperCase()).toContain('RESULTADOS GENERALES');

    // Confirmar que el PDF tiene exactamente 1 página (sin desbordes ni páginas vacías residuales)
    const strPdf = bufferPdf.toString('binary');
    const pageMatches = strPdf.match(/\/Type\s*\/Page\b/g);
    expect(pageMatches ? pageMatches.length : 0).toBe(1);
  });
});

describe('Reconciliador de Recordatorios de Periodo (P1 y P2)', () => {
  it('reconciliarRecordatoriosPeriodo: consolida áreas por auditor y respeta idempotencia', async () => {
    const { reconciliarRecordatoriosPeriodo } = await import('../modules/notificaciones/reconciliador-recordatorios');

    const notificacionesCreadas: any[] = [];
    const entregasCreadas: any[] = [];

    const fakeTx: any = {
      asignacionAuditoria: {
        findMany: async () => [
          {
            id: 101,
            estado: 'PENDIENTE',
            completadoEn: null,
            auditor: { id: 7, nombre: 'Auditor 7', correo: 'auditor7@cuadra.com.mx', activo: true },
            objetivoAuditoria: {
              anio: 2026,
              mes: 9,
              periodo: 1,
              canceladoEn: null,
              envioResultado: null,
              enviosAuditoria: [],
              area: { id: 1, nombre: 'Troquelado' },
              nombreAreaSnapshot: 'Troquelado',
            },
          },
          {
            id: 102,
            estado: 'EN_PROCESO',
            completadoEn: null,
            auditor: { id: 7, nombre: 'Auditor 7', correo: 'auditor7@cuadra.com.mx', activo: true },
            objetivoAuditoria: {
              anio: 2026,
              mes: 9,
              periodo: 1,
              canceladoEn: null,
              envioResultado: null,
              enviosAuditoria: [],
              area: { id: 2, nombre: 'Montado' },
              nombreAreaSnapshot: 'Montado',
            },
          },
        ],
      },
      notificacion: {
        findUnique: async ({ where }: any) => {
          return notificacionesCreadas.find((n) => n.claveDedupe === where.claveDedupe) ?? null;
        },
        create: async ({ data }: any) => {
          const nueva = { id: notificacionesCreadas.length + 1, ...data };
          notificacionesCreadas.push(nueva);
          return nueva;
        },
      },
      entregaNotificacion: {
        create: async ({ data }: any) => {
          entregasCreadas.push(data);
          return { id: entregasCreadas.length, ...data };
        },
      },
    };

    // Primera ejecución (forzada por prueba para simular ejecución dentro de ventana)
    const res1 = await reconciliarRecordatoriosPeriodo(fakeTx, 1, 2026, 9, new Date('2026-09-15T16:00:00Z'), true);

    expect(res1.creadas).toBe(1);
    expect(res1.duplicadas).toBe(0);
    expect(notificacionesCreadas.length).toBe(1);

    const notif = notificacionesCreadas[0];
    expect(notif.claveDedupe).toBe('recordatorio-periodo-correo:7:2026-09:P1');
    expect(notif.datos.areas).toEqual(['Troquelado', 'Montado']);
    expect(notif.datos.periodo).toBe(1);

    // Segunda ejecución (debe ser idempotente, 0 creadas, 1 duplicada)
    const res2 = await reconciliarRecordatoriosPeriodo(fakeTx, 1, 2026, 9, new Date('2026-09-15T16:00:00Z'), true);
    expect(res2.creadas).toBe(0);
    expect(res2.duplicadas).toBe(1);
    expect(notificacionesCreadas.length).toBe(1);
  });
});

describe('Descarga de Resultados Generales en PDF (Endpoint y Permisos)', () => {
  it('falla con 400 si los parámetros de consulta son inválidos', async () => {
    const { descargarResultadosGeneralPdf } = await import('../modules/resultados/09_descargar_pdf');
    const req: any = {
      query: { tipo: 'desconocido' },
      autenticacion: { usuarioId: 1, rol: 'SUPER_ADMIN' },
    };
    const res: any = {
      setHeader: () => {},
      end: () => {},
    };

    expect(descargarResultadosGeneralPdf(req, res)).rejects.toThrow();
  });

  it('mantiene la descarga PDF restringida a roles administrativos', async () => {
    const { ROLES_ADMIN_NEGOCIO } = await import('../utils/permisos');

    expect(ROLES_ADMIN_NEGOCIO).not.toContain('AUDITOR');
  });

  it('genera y retorna el PDF con cabeceras de descarga para SUPER_ADMIN', async () => {
    const { descargarResultadosGeneralPdf } = await import('../modules/resultados/09_descargar_pdf');
    const headersSet: Record<string, string | number> = {};
    let endBuffer: Buffer | null = null;

    const req: any = {
      query: { tipo: 'mes', mes: '2026-08' },
      autenticacion: { usuarioId: 1, rol: 'SUPER_ADMIN' },
    };
    const res: any = {
      setHeader: (name: string, value: string | number) => {
        headersSet[name] = value;
      },
      end: (buf: Buffer) => {
        endBuffer = buf;
      },
    };

    await descargarResultadosGeneralPdf(req, res);

    expect(headersSet['Content-Type']).toBe('application/pdf');
    expect(headersSet['Content-Disposition']).toContain('attachment; filename=');
    expect(headersSet['Content-Disposition']).toContain('.pdf');
    expect(endBuffer).not.toBeNull();
    expect(Buffer.isBuffer(endBuffer)).toBe(true);
    expect((endBuffer as any).length).toBeGreaterThan(1000);
    const pdfHeader = (endBuffer as any).slice(0, 5).toString('ascii');
    expect(pdfHeader.startsWith('%PDF-')).toBe(true);
  });
});

describe('Descarga Directa de PDF con Token Firmado Seguro (Sin Login)', () => {
  it('crearTokenDescargaPdf y verificarTokenDescargaPdf: firma, valida y verifica vigencia', async () => {
    const { crearTokenDescargaPdf, verificarTokenDescargaPdf } = await import('../modules/resultados/token_descarga_pdf');

    const token = crearTokenDescargaPdf({ tipo: 'mes', mes: '2026-08', usuarioId: 5 });
    expect(typeof token).toBe('string');
    expect(token.includes('.')).toBe(true);

    const verificado = verificarTokenDescargaPdf(token);
    expect(verificado.tipo).toBe('mes');
    expect(verificado.mes).toBe('2026-08');
    expect(verificado.usuarioId).toBe(5);
    expect(verificado.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it('rechaza tokens con firma adulterada o manipulada', async () => {
    const { crearTokenDescargaPdf, verificarTokenDescargaPdf } = await import('../modules/resultados/token_descarga_pdf');

    const tokenValido = crearTokenDescargaPdf({ tipo: 'mes', mes: '2026-08', usuarioId: 5 });
    const tokenAdulterado = `${tokenValido}modificado`;

    expect(() => verificarTokenDescargaPdf(tokenAdulterado)).toThrow();
  });

  it('rechaza tokens expirados', async () => {
    const { crearTokenDescargaPdf, verificarTokenDescargaPdf } = await import('../modules/resultados/token_descarga_pdf');

    const tokenExpirado = crearTokenDescargaPdf({ tipo: 'mes', mes: '2026-08', diasValidez: -1 });
    expect(() => verificarTokenDescargaPdf(tokenExpirado)).toThrow('expirado');
  });

  it('descargarResultadosGeneralPdfDirecto: entrega el PDF sin requerir sesión con token válido', async () => {
    const { crearTokenDescargaPdf } = await import('../modules/resultados/token_descarga_pdf');
    const { descargarResultadosGeneralPdfDirecto } = await import('../modules/resultados/10_descargar_pdf_directo');

    const token = crearTokenDescargaPdf({ tipo: 'mes', mes: '2026-08', usuarioId: 1 });
    const headersSet: Record<string, string | number> = {};
    let endBuffer: Buffer | null = null;

    const req: any = {
      query: { token },
    };
    const res: any = {
      setHeader: (name: string, value: string | number) => {
        headersSet[name] = value;
      },
      end: (buf: Buffer) => {
        endBuffer = buf;
      },
      status: () => res,
      send: () => res,
    };

    await descargarResultadosGeneralPdfDirecto(req, res);

    expect(headersSet['Content-Type']).toBe('application/pdf');
    expect(headersSet['Content-Disposition']).toBe('attachment; filename="Resultados Generales 5S - 2026-08.pdf"');
    expect(endBuffer).not.toBeNull();
    expect(Buffer.isBuffer(endBuffer)).toBe(true);
    const pdfStr = (endBuffer as any).toString('binary');
    const pageMatches = pdfStr.match(/\/Type\s*\/Page\b/g);
    expect(pageMatches ? pageMatches.length : 0).toBe(1);
  });

  it('descargarResultadosGeneralPdfDirecto: responde 400/403 con página amigable si el token es inválido o falta', async () => {
    const { descargarResultadosGeneralPdfDirecto } = await import('../modules/resultados/10_descargar_pdf_directo');

    let statusCode = 200;
    let htmlOutput = '';

    const req: any = {
      query: { token: 'invalido' },
    };
    const res: any = {
      setHeader: () => {},
      status: (code: number) => {
        statusCode = code;
        return res;
      },
      send: (body: string) => {
        htmlOutput = body;
        return res;
      },
      end: () => {},
    };

    await descargarResultadosGeneralPdfDirecto(req, res);

    expect(statusCode).toBe(403);
    expect(htmlOutput).toContain('Enlace de descarga no disponible');
  });
});
