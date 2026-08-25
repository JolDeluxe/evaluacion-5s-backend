import type { Usuario } from '../../generated/prisma/client';
import type { PrismaTransaction } from '../../db';
import { RolUsuario } from '../../generated/prisma/enums';
import { prohibido, solicitudInvalida } from '../../utils/errores';
import { esSuperAdmin } from '../../utils/permisos';

export const seleccionarUsuarioSeguro = {
  id: true,
  nombreUsuario: true,
  correo: true,
  telefonoE164: true,
  nombre: true,
  rol: true,
  activo: true,
  debeCambiarContrasena: true,
  ultimoInicioSesionEn: true,
  contrasenaCambiadaEn: true,
  creadoEn: true,
  actualizadoEn: true,
};

export const limpiarUsuario = (usuario: Usuario) => ({
  id: usuario.id,
  nombreUsuario: usuario.nombreUsuario,
  correo: usuario.correo,
  telefonoE164: usuario.telefonoE164,
  nombre: usuario.nombre,
  rol: usuario.rol,
  activo: usuario.activo,
  debeCambiarContrasena: usuario.debeCambiarContrasena,
  ultimoInicioSesionEn: usuario.ultimoInicioSesionEn,
  contrasenaCambiadaEn: usuario.contrasenaCambiadaEn,
  creadoEn: usuario.creadoEn,
  actualizadoEn: usuario.actualizadoEn,
});

export const assertPuedeGestionarRolUsuario = async (
  actor: { usuarioId: number; rol: RolUsuario } | undefined,
  objetivo: { id?: number; rol: RolUsuario; activo?: boolean },
  tx: PrismaTransaction,
  accion: 'crear' | 'actualizar' | 'desactivar' | 'reactivar' | 'contrasena'
) => {
  if (!actor) throw prohibido();

  const tocaSuperAdmin = objetivo.rol === RolUsuario.SUPER_ADMIN;
  if (tocaSuperAdmin && !esSuperAdmin(actor.rol)) {
    throw prohibido('Solo SUPER_ADMIN puede gestionar usuarios SUPER_ADMIN');
  }

  if (objetivo.id && tocaSuperAdmin && ['actualizar', 'desactivar'].includes(accion)) {
    const superAdminsActivos = await tx.usuario.count({
      where: {
        rol: RolUsuario.SUPER_ADMIN,
        activo: true,
        id: { not: objetivo.id },
      },
    });

    if (objetivo.activo !== false && superAdminsActivos === 0) {
      throw solicitudInvalida('No se puede dejar el sistema sin un SUPER_ADMIN activo');
    }
  }
};

export const assertNoQuitaUltimoSuperAdmin = async (
  usuarioId: number,
  rolAnterior: RolUsuario,
  rolNuevo: RolUsuario | undefined,
  activoAnterior: boolean,
  tx: PrismaTransaction
) => {
  if (rolAnterior !== RolUsuario.SUPER_ADMIN) return;
  if (!activoAnterior) return;
  if (!rolNuevo || rolNuevo === RolUsuario.SUPER_ADMIN) return;

  const otrosSuperAdminsActivos = await tx.usuario.count({
    where: {
      rol: RolUsuario.SUPER_ADMIN,
      activo: true,
      id: { not: usuarioId },
    },
  });

  if (otrosSuperAdminsActivos === 0) {
    throw solicitudInvalida('No se puede dejar el sistema sin un SUPER_ADMIN activo');
  }
};
