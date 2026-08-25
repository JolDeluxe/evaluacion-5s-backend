export class ErrorApi extends Error {
  readonly estado: number;
  readonly codigo: string;

  constructor(estado: number, codigo: string, mensaje: string) {
    super(mensaje);
    this.estado = estado;
    this.codigo = codigo;
  }
}

export const solicitudInvalida = (mensaje: string) => new ErrorApi(400, 'SOLICITUD_INVALIDA', mensaje);
export const noAutenticado = (mensaje = 'Sesion no valida') => new ErrorApi(401, 'NO_AUTENTICADO', mensaje);
export const prohibido = (mensaje = 'No tienes permiso para realizar esta accion') => new ErrorApi(403, 'PROHIBIDO', mensaje);
export const noEncontrado = (mensaje = 'Recurso no encontrado') => new ErrorApi(404, 'NO_ENCONTRADO', mensaje);
export const conflicto = (mensaje: string) => new ErrorApi(409, 'CONFLICTO', mensaje);
export const servicioNoDisponible = (mensaje: string) => new ErrorApi(503, 'SERVICIO_NO_DISPONIBLE', mensaje);
