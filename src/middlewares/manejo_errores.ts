import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { Prisma } from '../generated/prisma/client';
import { ErrorApi } from '../utils/errores';
import { env } from '../config/env';

export const noEncontradoHandler = (req: Request, res: Response) => {
  res.status(404).json({
    error: {
      codigo: 'NO_ENCONTRADO',
      mensaje: `Ruta no encontrada: ${req.method} ${req.path}`,
    },
  });
};

export const manejoErrores = (err: unknown, req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof ErrorApi) {
    res.locals.codigoError = err.codigo;
    const payload = {
      statusCode: err.estado,
      codigo: err.codigo,
      requestId: req.idPeticion,
    };

    if (err.estado >= 500) {
      req.log.error({ err, ...payload }, 'Error de API');
    }

    res.status(err.estado).json({
      error: {
        codigo: err.codigo,
        mensaje: err.message,
        ...(err.datos
          ? typeof err.datos === 'object' && ('periodoAnterior' in err.datos || 'totalPendientes' in err.datos)
            ? err.datos
            : { periodoAnterior: err.datos }
          : {}),
      },
    });
    return;
  }

  if (err instanceof ZodError) {
    res.locals.codigoError = 'VALIDACION_INVALIDA';
    res.status(400).json({
      error: {
        codigo: 'VALIDACION_INVALIDA',
        mensaje: 'Datos invalidos',
        detalles: err.issues.map((issue) => ({
          ruta: issue.path.join('.'),
          mensaje: issue.message,
        })),
      },
    });
    return;
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
    res.locals.codigoError = 'CONFLICTO';
    res.status(409).json({ error: { codigo: 'CONFLICTO', mensaje: 'El registro ya existe' } });
    return;
  }

  res.locals.codigoError = 'ERROR_INTERNO';
  req.log.error({ err, statusCode: 500, codigo: 'ERROR_INTERNO', requestId: req.idPeticion }, 'Error interno');
  res.status(500).json({
    error: {
      codigo: 'ERROR_INTERNO',
      mensaje: 'Error interno del servidor',
      ...(env.NODE_ENV === 'development' && err instanceof Error ? { detalle: err.message } : {}),
    },
  });
};
