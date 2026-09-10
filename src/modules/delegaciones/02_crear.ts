import type { Request, Response } from 'express';
import { prisma } from '../../db';
import { conflicto, noAutenticado, solicitudInvalida } from '../../utils/errores';
import { puedeEjecutarAuditoria } from '../../utils/permisos';
import { responderCreado } from '../../utils/respuesta';
import { registrarAuditoria } from '../registros_auditoria/helper';
import { esquemaCrearDelegacion } from './zod';

export const crearDelegacion = async (req: Request, res: Response) => {
  const adminId = req.autenticacion?.usuarioId;
  if (!adminId) throw noAutenticado();

  const body = esquemaCrearDelegacion.parse(req.body);

  if (body.ejecutorId === body.responsableId) {
    throw solicitudInvalida('Un usuario no puede delegarse el cumplimiento a sí mismo');
  }

  if (body.vigenteHasta && body.vigenteDesde.getTime() > body.vigenteHasta.getTime()) {
    throw solicitudInvalida('La fecha de fin no puede ser anterior a la fecha de inicio');
  }

  const delegacion = await prisma.$transaction(async (tx) => {
    const [ejecutor, responsable] = await Promise.all([
      tx.usuario.findUnique({ where: { id: body.ejecutorId } }),
      tx.usuario.findUnique({ where: { id: body.responsableId } }),
    ]);

    if (!ejecutor || !ejecutor.activo) {
      throw solicitudInvalida('El auditor ejecutor no existe o no está activo');
    }

    if (!puedeEjecutarAuditoria(ejecutor.rol)) {
      throw solicitudInvalida('El usuario ejecutor debe tener un rol que le permita ejecutar auditorías');
    }

    if (!responsable || !responsable.activo) {
      throw solicitudInvalida('El responsable del cumplimiento no existe o no está activo');
    }

    if (body.activa) {
      const duplicada = await tx.delegacionCumplimiento.findFirst({
        where: {
          ejecutorId: body.ejecutorId,
          responsableId: body.responsableId,
          activa: true,
        },
      });

      if (duplicada) {
        throw conflicto('Ya existe una delegación activa entre este auditor ejecutor y el responsable');
      }

      // Comprobar que no haya ciclo directo A -> B y B -> A activo
      const cicloInverso = await tx.delegacionCumplimiento.findFirst({
        where: {
          ejecutorId: body.responsableId,
          responsableId: body.ejecutorId,
          activa: true,
        },
      });

      if (cicloInverso) {
        throw conflicto('No se permite una delegación circular: el responsable ya delega su cumplimiento en este ejecutor');
      }
    }

    const creada = await tx.delegacionCumplimiento.create({
      data: {
        ejecutorId: body.ejecutorId,
        responsableId: body.responsableId,
        vigenteDesde: body.vigenteDesde,
        vigenteHasta: body.vigenteHasta,
        activa: body.activa,
      },
      include: {
        ejecutor: {
          select: {
            id: true,
            nombre: true,
            nombreUsuario: true,
            correo: true,
            rol: true,
            activo: true,
          },
        },
        responsable: {
          select: {
            id: true,
            nombre: true,
            nombreUsuario: true,
            correo: true,
            rol: true,
            activo: true,
          },
        },
      },
    });

    await registrarAuditoria({
      usuarioId: adminId,
      accion: 'CREAR_DELEGACION_CUMPLIMIENTO',
      tipoEntidad: 'DelegacionCumplimiento',
      idEntidad: creada.id,
      datosNuevos: {
        id: creada.id,
        ejecutorId: creada.ejecutorId,
        ejecutorNombre: creada.ejecutor.nombre,
        responsableId: creada.responsableId,
        responsableNombre: creada.responsable.nombre,
        vigenteDesde: creada.vigenteDesde,
        vigenteHasta: creada.vigenteHasta,
        activa: creada.activa,
      },
    }, tx);

    return creada;
  });

  responderCreado(res, delegacion);
};
