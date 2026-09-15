import type { Request, Response } from 'express';
import { prisma } from '../../db';
import { responder } from '../../utils/respuesta';
import {
  asegurarProgramacionMensual,
  obtenerVistaMensual,
  puedeAsegurarProgramacionMensual,
} from './programacion_mensual';

export const obtenerAlertasAsignaciones = async (req: Request, res: Response) => {
  const ahora = new Date();
  const anio = req.query.anio ? Number(req.query.anio) : ahora.getFullYear();
  const mes = req.query.mes ? Number(req.query.mes) : ahora.getMonth() + 1;
  const usuarioId = req.autenticacion?.usuarioId ?? 1;

  if (puedeAsegurarProgramacionMensual(anio, mes)) {
    await asegurarProgramacionMensual(prisma as any, anio, mes, usuarioId);
  }

  const vista = await obtenerVistaMensual(prisma as any, anio, mes);

  responder(res, {
    faltantes: vista.resumen.sinAuditor,
    totalAreas: vista.resumen.areas,
  });
};

