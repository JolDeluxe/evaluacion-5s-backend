import { describe, expect, it } from 'bun:test';
import { generarQrBuffer } from '../modules/notificaciones/qr';
import { renderAuditAssignmentMonthly } from '../modules/notificaciones/templates/audit_assignment_monthly';
import { renderMonthlyResults } from '../modules/notificaciones/templates/monthly_results';
import { resolverTemplate } from '../modules/notificaciones/templates';

describe('Templates de Notificaciones por Correo', () => {
  describe('audit_assignment_monthly', () => {
    it('renderiza correctamente el template de asignaciones con áreas y URL', () => {
      const data = {
        templateName: 'audit_assignment_monthly' as const,
        templateVersion: 'v1' as const,
        auditorNombre: 'Andrea Gómez',
        mes: '2026-09',
        mesEtiqueta: 'Septiembre 2026',
        areas: ['BORDADO', 'MANTENIMIENTO', 'LASER', 'PPCP - MAQUILA'],
        urlMisAuditorias: 'http://localhost:5173/mis-auditorias',
      };

      const result = renderAuditAssignmentMonthly(data);

      expect(result.subject).toBe('Auditorías asignadas — Septiembre 2026');
      expect(result.qrUrl).toBe('http://localhost:5173/mis-auditorias');

      // HTML validations
      expect(result.html).toContain('Andrea Gómez');
      expect(result.html).toContain('Septiembre 2026');
      expect(result.html).toContain('BORDADO');
      expect(result.html).toContain('MANTENIMIENTO');
      expect(result.html).toContain('LASER');
      expect(result.html).toContain('PPCP - MAQUILA');
      expect(result.html).toContain('http://localhost:5173/mis-auditorias');
      expect(result.html).toContain('cid:qr-code');

      // Text validations
      expect(result.text).toContain('Hola Andrea Gómez');
      expect(result.text).toContain('1. BORDADO');
      expect(result.text).toContain('2. MANTENIMIENTO');
      expect(result.text).toContain('http://localhost:5173/mis-auditorias');
    });

    it('escapa caracteres especiales en nombres de auditor y áreas para prevenir XSS', () => {
      const data = {
        templateName: 'audit_assignment_monthly' as const,
        templateVersion: 'v1' as const,
        auditorNombre: 'Juan <script>alert(1)</script> & Co.',
        mes: '2026-09',
        mesEtiqueta: 'Septiembre 2026',
        areas: ['ÁREA <B>TEST</B>'],
        urlMisAuditorias: 'http://localhost:5173/mis-auditorias',
      };

      const result = renderAuditAssignmentMonthly(data);
      expect(result.html).not.toContain('<script>');
      expect(result.html).toContain('Juan &lt;script&gt;alert(1)&lt;/script&gt; &amp; Co.');
      expect(result.html).toContain('ÁREA &lt;B&gt;TEST&lt;/B&gt;');
    });
  });

  describe('monthly_results', () => {
    it('renderiza resultados consolidados para un usuario con múltiples áreas', () => {
      const data = {
        templateName: 'monthly_results' as const,
        templateVersion: 'v1' as const,
        destinatarioNombre: 'Carlos Ramos',
        mes: '2026-08',
        mesEtiqueta: 'Agosto 2026',
        areas: [
          { nombre: 'BORDADO', resultado: 95.5 },
          { nombre: 'CORTE', resultado: 78.0 },
          { nombre: 'EMPAQUE', resultado: 45.0 },
        ],
        resultadoGeneral: 88.2,
        urlResultados: 'http://localhost:5173/resultados/general?tipo=mes&mes=2026-08',
      };

      const result = renderMonthlyResults(data);

      expect(result.subject).toBe('Resultados 5S — Agosto 2026');
      expect(result.qrUrl).toBe('http://localhost:5173/resultados/general?tipo=mes&mes=2026-08');

      // HTML validations
      expect(result.html).toContain('Carlos Ramos');
      expect(result.html).toContain('Agosto 2026');
      expect(result.html).toContain('88.2%');
      expect(result.html).toContain('BORDADO');
      expect(result.html).toContain('95.5%');
      expect(result.html).toContain('Excelente');
      expect(result.html).toContain('CORTE');
      expect(result.html).toContain('78.0%');
      expect(result.html).toContain('Satisfactorio');
      expect(result.html).toContain('EMPAQUE');
      expect(result.html).toContain('45.0%');
      expect(result.html).toContain('Crítico');
      expect(result.html).toContain('cid:qr-code');

      // Text validations
      expect(result.text).toContain('BORDADO: 95.5% (Excelente)');
      expect(result.text).toContain('Resultado Global: 88.2%');
    });

    it('renderiza resultados para un ADMINISTRADOR sin áreas directas a cargo', () => {
      const data = {
        templateName: 'monthly_results' as const,
        templateVersion: 'v1' as const,
        destinatarioNombre: 'Super Administrador',
        mes: '2026-08',
        mesEtiqueta: 'Agosto 2026',
        areas: [],
        resultadoGeneral: 92.4,
        urlResultados: 'http://localhost:5173/resultados/general?tipo=mes&mes=2026-08',
      };

      const result = renderMonthlyResults(data);

      expect(result.html).toContain('Super Administrador');
      expect(result.html).toContain('92.4%');
      expect(result.html).toContain('Excelente');
      expect(result.html).not.toContain('Tus Áreas Evaluadas');
      expect(result.text).toContain('Resultado Global: 92.4% (Excelente)');
    });
  });

  describe('resolverTemplate', () => {
    it('resuelve correctamente template por nombre estructurado', () => {
      const data = {
        templateName: 'audit_assignment_monthly' as const,
        templateVersion: 'v1' as const,
        auditorNombre: 'Laura',
        mes: '2026-09',
        mesEtiqueta: 'Septiembre 2026',
        areas: ['CORTE'],
        urlMisAuditorias: 'http://localhost/auditorias',
      };

      const resolved = resolverTemplate(data);
      expect(resolved).not.toBeNull();
      expect(resolved?.subject).toContain('Septiembre 2026');
    });

    it('usa fallback si no hay templateName estructurado', () => {
      const fallback = {
        titulo: 'Aviso genérico',
        mensaje: 'Este es un mensaje de prueba',
      };

      const resolved = resolverTemplate(null, fallback);
      expect(resolved).not.toBeNull();
      expect(resolved?.subject).toBe('Aviso genérico');
      expect(resolved?.text).toBe('Este es un mensaje de prueba');
    });
  });

  describe('generarQrBuffer', () => {
    it('genera un buffer PNG válido', async () => {
      const url = 'https://5s-mbc.netlify.app/mis-auditorias';
      const buffer = await generarQrBuffer(url);

      expect(Buffer.isBuffer(buffer)).toBe(true);
      expect(buffer.length).toBeGreaterThan(100);

      // Validar Magic Bytes de PNG: 89 50 4E 47 0D 0A 1A 0A
      expect(buffer[0]).toBe(0x89);
      expect(buffer[1]).toBe(0x50);
      expect(buffer[2]).toBe(0x4E);
      expect(buffer[3]).toBe(0x47);
      expect(buffer[4]).toBe(0x0D);
      expect(buffer[5]).toBe(0x0A);
      expect(buffer[6]).toBe(0x1A);
      expect(buffer[7]).toBe(0x0A);
    });
  });
});