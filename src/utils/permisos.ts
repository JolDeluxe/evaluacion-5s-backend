import { RolUsuario } from '../generated/prisma/enums';

export const ROLES_CON_CUENTA = [
  RolUsuario.SUPER_ADMIN,
  RolUsuario.ADMINISTRADOR,
  RolUsuario.AUDITOR,
] as const;

export const ROLES_QUE_CONSULTAN_AUDITORIAS = ROLES_CON_CUENTA;

export const ROLES_QUE_EJECUTAN_AUDITORIAS = [
  RolUsuario.AUDITOR,
  RolUsuario.ADMINISTRADOR,
] as const;

export const ROLES_ADMIN_NEGOCIO = [
  RolUsuario.ADMINISTRADOR,
  RolUsuario.SUPER_ADMIN,
] as const;

export const ROLES_RESULTADOS_COMPLETOS = [
  RolUsuario.ADMINISTRADOR,
  RolUsuario.SUPER_ADMIN,
] as const;

export const esSuperAdmin = (rol?: RolUsuario | null) => rol === RolUsuario.SUPER_ADMIN;
export const puedeConsultarAuditorias = (rol?: RolUsuario | null) => Boolean(
  rol && ROLES_QUE_CONSULTAN_AUDITORIAS.some((permitido) => permitido === rol)
);
export const puedeEjecutarAuditoria = (rol?: RolUsuario | null) => Boolean(
  rol && ROLES_QUE_EJECUTAN_AUDITORIAS.some((permitido) => permitido === rol)
);
export const puedeAdministrar5S = (rol?: RolUsuario | null) => rol === RolUsuario.ADMINISTRADOR || rol === RolUsuario.SUPER_ADMIN;
export const puedeVerResultadosCompletos = puedeAdministrar5S;
