import { Prisma } from '../../generated/prisma/client';
import { RolUsuario } from '../../generated/prisma/enums';
import { conflicto, prohibido, solicitudInvalida } from '../../utils/errores';
import { puedeEjecutarAuditoria } from '../../utils/permisos';

export type RespuestaEntrada5S = {
  preguntaFormularioId: number;
  cumple: boolean;
  hallazgo?: string | null;
  fotos?: FotoEntrada5S[];
};

export type FotoEntrada5S = {
  identificadorCliente: string;
  publicIdCloudinary: string;
  assetIdCloudinary?: string | null;
  formato?: string | null;
  tipoMime?: string | null;
  bytes?: number | null;
  ancho?: number | null;
  alto?: number | null;
  capturadaEn?: Date | null;
  subidaEn?: Date | null;
};

export const normalizarCodigoVerificacion = (codigo: string) => (codigo ?? '').trim().toUpperCase().replace(/[\s-]/g, '');

export const validarCodigoArea = (esperado: string, recibido: string) => {
  if (normalizarCodigoVerificacion(esperado) !== normalizarCodigoVerificacion(recibido)) {
    throw solicitudInvalida('El codigo de verificacion del area no coincide');
  }
};

export const validarUsuarioPuedeAuditar = (rol: string, esMismaArea: boolean) => {
  const rolUsuario = Object.values(RolUsuario).find((valor) => valor === rol);
  if (!puedeEjecutarAuditoria(rolUsuario)) throw prohibido('Este rol no puede realizar auditorias');
  if (esMismaArea) throw prohibido('No puedes auditar tu propia area');
};

export const validarRespuestas5S = (
  preguntasEsperadas: { id: number; requiereHallazgo?: boolean }[],
  respuestas: RespuestaEntrada5S[]
) => {
  const preguntasMap = new Map(preguntasEsperadas.map((pregunta) => [pregunta.id, pregunta]));
  const idsRecibidos = new Set<number>();

  if (respuestas.length !== preguntasEsperadas.length) {
    throw solicitudInvalida(`La auditoria requiere exactamente ${preguntasEsperadas.length} respuestas`);
  }

  for (const respuesta of respuestas) {
    if (idsRecibidos.has(respuesta.preguntaFormularioId)) {
      throw solicitudInvalida('Hay preguntas duplicadas en las respuestas');
    }
    idsRecibidos.add(respuesta.preguntaFormularioId);

    const pregEsperada = preguntasMap.get(respuesta.preguntaFormularioId);
    if (!pregEsperada) {
      throw solicitudInvalida('Una respuesta no pertenece a la version del formulario de este objetivo');
    }

    if (typeof respuesta.cumple !== 'boolean') {
      throw solicitudInvalida('cumple debe ser booleano');
    }

    const exigeHallazgo = pregEsperada.requiereHallazgo !== false;
    if (!respuesta.cumple && exigeHallazgo && !respuesta.hallazgo?.trim()) {
      throw solicitudInvalida('El hallazgo es obligatorio cuando la respuesta es NO');
    }
  }

  if (idsRecibidos.size !== preguntasMap.size) {
    throw solicitudInvalida('Faltan respuestas del formulario');
  }
};

export const calcularPuntaje5S = (respuestas: RespuestaEntrada5S[]) => {
  const puntajePosible = respuestas.length;
  if (puntajePosible === 0) throw conflicto('La version del formulario no tiene preguntas');

  const puntajeObtenido = respuestas.filter((respuesta) => respuesta.cumple).length;
  const porcentaje = (puntajeObtenido / puntajePosible) * 100;

  return {
    puntajeObtenido: new Prisma.Decimal(puntajeObtenido),
    puntajePosible: new Prisma.Decimal(puntajePosible),
    porcentaje: new Prisma.Decimal(porcentaje.toFixed(4)),
  };
};
