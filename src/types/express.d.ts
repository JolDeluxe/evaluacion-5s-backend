import type { RolUsuario } from '../generated/prisma/enums';

declare global {
  namespace Express {
    interface Request {
      autenticacion?: {
        usuarioId: number;
        sesionId: number;
        rol: RolUsuario;
      };
      idPeticion?: string;
    }
  }
}

export {};
