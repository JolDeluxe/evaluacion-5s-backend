import type { Request, Response } from 'express';
import type { PrismaTransaction } from '../../db';
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

  const tx = prisma as unknown as PrismaTransaction;

  if (puedeAsegurarProgramacionMensual(anio, mes)) {
    await asegurarProgramacionMensual(tx, anio, mes, usuarioId);
  }

  const vista = await obtenerVistaMensual(tx, anio, mes);

  responder(res, {
    faltantes: vista.resumen.sinAuditor,
    totalAreas: vista.resumen.areas,
  });
};

