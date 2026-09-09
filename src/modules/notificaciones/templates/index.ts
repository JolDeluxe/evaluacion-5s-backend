import type { MonthlyAssignmentsData, TemplateRenderResult } from './audit_assignment_monthly';
import { renderAuditAssignmentMonthly } from './audit_assignment_monthly';
import type { MonthlyResultsData } from './monthly_results';
import { renderMonthlyResults } from './monthly_results';
import type { PeriodReminderData } from './period_reminder';
import { renderPeriodReminder } from './period_reminder';

export type NotificacionTemplateData =
  | MonthlyAssignmentsData
  | MonthlyResultsData
  | PeriodReminderData;

export type { TemplateRenderResult };

/**
 * Resuelve y compila el template correspondiente según los datos estructurados en notificacion.datos.
 * Si no se especifica un templateName válido, retorna null para permitir renderizado genérico.
 */
export const resolverTemplate = (
  datos: unknown,
  fallback?: { titulo: string; mensaje: string; ruta?: string | null }
): TemplateRenderResult | null => {
  if (datos && typeof datos === 'object' && 'templateName' in datos) {
    const payload = datos as { templateName: string };

    if (payload.templateName === 'audit_assignment_monthly') {
      return renderAuditAssignmentMonthly(datos as MonthlyAssignmentsData);
    }

    if (payload.templateName === 'monthly_results') {
      return renderMonthlyResults(datos as MonthlyResultsData);
    }

    if (payload.templateName === 'period_reminder') {
      return renderPeriodReminder(datos as PeriodReminderData);
    }
  }

  if (fallback) {
    return {
      subject: fallback.titulo,
      text: fallback.mensaje,
      html: `
        <div style="font-family: sans-serif; padding: 20px; color: #1e293b;">
          <h2 style="color: #0f172a; margin-top: 0;">${fallback.titulo}</h2>
          <p style="white-space: pre-wrap; line-height: 1.5;">${fallback.mensaje}</p>
        </div>
      `,
    };
  }

  return null;
};