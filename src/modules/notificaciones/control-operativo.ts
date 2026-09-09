import { prisma, type PrismaTransaction } from '../../db';

export const CLAVE_CONTROL_OPERATIVO_CORREOS = 'control_operativo_correos';

export type EstadoControlOperativo = 'ACTIVO' | 'PAUSADO';

export type InfoControlOperativo = {
  estado: EstadoControlOperativo;
  actualizadoEn?: string;
  actualizadoPorId?: number;
  motivo?: string;
};

/**
 * Obtiene el estado del control operativo de correos con política FAIL-SAFE:
 * Si el registro no existe, si falla la lectura o si el valor no es reconocido,
 * SIEMPRE devuelve 'PAUSADO'. Solo una acción explícita puede dejarlo 'ACTIVO'.
 */
export const obtenerEstadoControlOperativo = async (
  tx: PrismaTransaction | typeof prisma = prisma
): Promise<InfoControlOperativo> => {
  try {
    const registro = await tx.secretoSistema.findUnique({
      where: { clave: CLAVE_CONTROL_OPERATIVO_CORREOS },
    });

    if (!registro || !registro.valorCifrado) {
      return { estado: 'PAUSADO', motivo: 'Registro no inicializado' };
    }

    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(registro.valorCifrado);
    } catch {
      // Si no es JSON válido o es string plano
      if (registro.valorCifrado === 'ACTIVO') {
        return { estado: 'ACTIVO', actualizadoEn: registro.actualizadoEn.toISOString() };
      }
      return { estado: 'PAUSADO', motivo: 'Formato no reconocido' };
    }

    if (parsed.estado === 'ACTIVO') {
      return {
        estado: 'ACTIVO',
        actualizadoEn: typeof parsed.actualizadoEn === 'string' ? parsed.actualizadoEn : registro.actualizadoEn.toISOString(),
        actualizadoPorId: typeof parsed.actualizadoPorId === 'number' ? parsed.actualizadoPorId : undefined,
        motivo: typeof parsed.motivo === 'string' ? parsed.motivo : undefined,
      };
    }

    return {
      estado: 'PAUSADO',
      actualizadoEn: typeof parsed.actualizadoEn === 'string' ? parsed.actualizadoEn : registro.actualizadoEn.toISOString(),
      actualizadoPorId: typeof parsed.actualizadoPorId === 'number' ? parsed.actualizadoPorId : undefined,
      motivo: typeof parsed.motivo === 'string' ? parsed.motivo : undefined,
    };
  } catch (error) {
    console.error('[ControlOperativo] Error al leer estado de control operativo, aplicando fail-safe PAUSADO:', error);
    return { estado: 'PAUSADO', motivo: 'Error en lectura de base de datos (fail-safe)' };
  }
};

/**
 * Actualiza el estado operativo de los correos automáticos (ACTIVO o PAUSADO).
 */
export const actualizarEstadoControlOperativo = async (
  nuevoEstado: EstadoControlOperativo,
  usuarioId: number,
  motivo?: string,
  tx: PrismaTransaction | typeof prisma = prisma
): Promise<InfoControlOperativo> => {
  const ahora = new Date().toISOString();
  const payload: InfoControlOperativo = {
    estado: nuevoEstado,
    actualizadoEn: ahora,
    actualizadoPorId: usuarioId,
    motivo: motivo || (nuevoEstado === 'ACTIVO' ? 'Reanudación manual por SUPER_ADMIN' : 'Pausa manual por SUPER_ADMIN'),
  };

  const valorCifrado = JSON.stringify(payload);

  await tx.secretoSistema.upsert({
    where: { clave: CLAVE_CONTROL_OPERATIVO_CORREOS },
    create: {
      clave: CLAVE_CONTROL_OPERATIVO_CORREOS,
      valorCifrado,
      metadatos: { tipo: 'control_operativo', actualizadoPorId: usuarioId },
    },
    update: {
      valorCifrado,
      metadatos: { tipo: 'control_operativo', actualizadoPorId: usuarioId },
    },
  });

  return payload;
};
