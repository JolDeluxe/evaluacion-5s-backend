import { describe, expect, it } from 'bun:test';
import fs from 'fs';
import type { PrismaTransaction } from '../db';
import {
  escaparCsv,
  generarAtrasosCsvString,
  generarResultadosCsvString,
  resolverResponsableReal,
  sincronizarArchivosCsv,
} from '../modules/sistema/servicio_exportacion_csv';

describe('servicio_exportacion_csv', () => {
  describe('resolverResponsableReal', () => {
    it('debe priorizar el responsable de cumplimiento de la asignación de auditoría', () => {
      const resp = resolverResponsableReal(
        { usuariosArea: [{ usuario: { id: 1, nombre: 'Jefe de Área' } }] },
        { responsableCumplimiento: { id: 2, nombre: 'Responsable Específico' } },
        { responsableCumplimiento: { id: 3, nombre: 'Responsable Mensual' } },
      );
      expect(resp).toBe('Responsable Específico');
    });

    it('debe priorizar el responsable de cumplimiento mensual si no hay en auditoría', () => {
      const resp = resolverResponsableReal(
        { usuariosArea: [{ usuario: { id: 1, nombre: 'Jefe de Área' } }] },
        null,
        { responsableCumplimiento: { id: 3, nombre: 'Responsable Mensual' } },
      );
      expect(resp).toBe('Responsable Mensual');
    });

    it('debe resolver los usuarios del catálogo de área si no hay asignación explícita', () => {
      const resp = resolverResponsableReal(
        {
          usuariosArea: [
            { usuario: { id: 1, nombre: 'Sergio Arenas' } },
            { usuario: { id: 2, nombre: 'Paz Luna' } },
          ],
        },
        null,
        null,
      );
      expect(resp).toBe('Sergio Arenas / Paz Luna');
    });

    it('debe devolver "Sin Responsable" si no existe ninguno en el catálogo ni asignaciones', () => {
      const resp = resolverResponsableReal({ usuariosArea: [] }, null, null);
      expect(resp).toBe('Sin Responsable');
    });
  });

  describe('escaparCsv', () => {
    it('debe escapar texto simple sin comillas', () => {
      expect(escaparCsv('Hola')).toBe('Hola');
      expect(escaparCsv(123)).toBe('123');
      expect(escaparCsv('')).toBe('');
      expect(escaparCsv(null)).toBe('');
    });

    it('debe envolver en comillas si contiene comas o saltos de línea', () => {
      expect(escaparCsv('Hola, mundo')).toBe('"Hola, mundo"');
      expect(escaparCsv('Línea 1\nLínea 2')).toBe('"Línea 1\nLínea 2"');
    });

    it('debe duplicar comillas internas', () => {
      expect(escaparCsv('Dijo "Hola"')).toBe('"Dijo ""Hola"""');
    });
  });

  describe('generación de resultados.csv con mock tx', () => {
    it('debe formatear correctamente las columnas y calcular el resultado mensual', async () => {
      const mockTx = {
        objetivoAuditoria: {
          findMany: async () => [
            {
              anio: 2026,
              mes: 1,
              periodo: 1,
              areaId: 10,
              nombreAreaSnapshot: 'PESPUNTE',
              canceladoEn: null,
              terminaEn: new Date('2026-01-15T23:59:59Z'),
              area: {
                usuariosArea: [{ usuario: { id: 101, nombre: 'Patricia Sánchez' } }],
              },
              envioResultado: {
                id: 1,
                porcentaje: '85.50',
                invalidadoEn: null,
              },
              asignacionesAuditoria: [],
            },
            {
              anio: 2026,
              mes: 1,
              periodo: 2,
              areaId: 10,
              nombreAreaSnapshot: 'PESPUNTE',
              canceladoEn: null,
              terminaEn: new Date('2026-01-31T23:59:59Z'),
              area: {
                usuariosArea: [{ usuario: { id: 101, nombre: 'Patricia Sánchez' } }],
              },
              envioResultado: {
                id: 2,
                porcentaje: '95.50',
                invalidadoEn: null,
              },
              asignacionesAuditoria: [],
            },
          ],
        },
        asignacionMensual: {
          findMany: async () => [],
        },
      } as unknown as PrismaTransaction;

      const { contenido, totalRegistros } = await generarResultadosCsvString(mockTx);
      expect(totalRegistros).toBe(1);

      const lineas = contenido.split('\r\n');
      expect(lineas[0]).toBe('AÑO,MES,AREA,RESPONSABLE,RESULTADO PRIMER PERIODO,RESULTADO SEGUNDO PERIODO,RESULTADO FINAL');
      expect(lineas[1]).toBe('2026,Enero,PESPUNTE,Patricia Sánchez,85.50,95.50,90.50');
    });
  });

  describe('generación de atrasos.csv con mock tx', () => {
    it('debe agrupar por periodo y mes con numeración 1, 2, 3... y separadores', async () => {
      const mockTx = {
        envioAuditoria: {
          findMany: async () => [
            {
              id: 1,
              realizadaATiempo: false,
              verificadoEn: new Date('2026-01-18T10:00:00Z'),
              asignacionAuditoriaId: 10,
              objetivoAuditoria: {
                anio: 2026,
                mes: 1,
                periodo: 1,
                areaId: 10,
                nombreAreaSnapshot: 'PESPUNTE',
                terminaEn: new Date('2026-01-15T23:59:59Z'),
                area: {
                  usuariosArea: [{ usuario: { id: 101, nombre: 'Patricia Sánchez' } }],
                },
                asignacionesAuditoria: [{ id: 10, responsableCumplimiento: null }],
              },
            },
            {
              id: 2,
              realizadaATiempo: false,
              verificadoEn: new Date('2026-01-19T10:00:00Z'),
              asignacionAuditoriaId: 11,
              objetivoAuditoria: {
                anio: 2026,
                mes: 1,
                periodo: 1,
                areaId: 11,
                nombreAreaSnapshot: 'BOLSAS',
                terminaEn: new Date('2026-01-15T23:59:59Z'),
                area: {
                  usuariosArea: [{ usuario: { id: 102, nombre: 'Armando Ramírez' } }],
                },
                asignacionesAuditoria: [{ id: 11, responsableCumplimiento: null }],
              },
            },
            {
              id: 3,
              realizadaATiempo: false,
              verificadoEn: new Date('2026-02-02T10:00:00Z'),
              asignacionAuditoriaId: 12,
              objetivoAuditoria: {
                anio: 2026,
                mes: 1,
                periodo: 2,
                areaId: 12,
                nombreAreaSnapshot: 'MONTADO',
                terminaEn: new Date('2026-01-31T23:59:59Z'),
                area: {
                  usuariosArea: [{ usuario: { id: 103, nombre: 'Carlos Villegas' } }],
                },
                asignacionesAuditoria: [{ id: 12, responsableCumplimiento: null }],
              },
            },
          ],
        },
        asignacionMensual: {
          findMany: async () => [],
        },
      } as unknown as PrismaTransaction;

      const { contenido, totalRegistros } = await generarAtrasosCsvString(mockTx);
      expect(totalRegistros).toBe(3);

      const lineas = contenido.split('\r\n');
      expect(lineas[0]).toBe('NO,AÑO,MES,PERIODO,RESPONSABLE,AREA');
      // Periodo 1
      expect(lineas[1]).toBe('1,2026,Enero,Primer Periodo,Patricia Sánchez,PESPUNTE');
      expect(lineas[2]).toBe('2,2026,Enero,Primer Periodo,Armando Ramírez,BOLSAS');
      // Línea en blanco entre periodos
      expect(lineas[3]).toBe('');
      // Periodo 2 (reinicia numeración en 1)
      expect(lineas[4]).toBe('1,2026,Enero,Segundo Periodo,Carlos Villegas,MONTADO');
    });
  });

  describe('escritura física de archivos CSV', () => {
    it('debe escribir ambos archivos con BOM UTF-8', async () => {
      const res = await sincronizarArchivosCsv();
      expect(fs.existsSync(res.rutaResultados)).toBe(true);
      expect(fs.existsSync(res.rutaAtrasos)).toBe(true);

      const buf = fs.readFileSync(res.rutaResultados);
      expect(buf[0]).toBe(0xef);
      expect(buf[1]).toBe(0xbb);
      expect(buf[2]).toBe(0xbf);
    });
  });
});
