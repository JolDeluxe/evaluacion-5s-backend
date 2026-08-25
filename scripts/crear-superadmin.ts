import { RolUsuario } from '../src/generated/prisma/enums';
import { prisma, cerrarPrisma } from '../src/db';
import {
  generarTokenSeguro,
  hashContrasena,
  normalizarCorreo,
  normalizarNombreUsuario,
} from '../src/utils/crypto';

const nombreUsuario = normalizarNombreUsuario(Bun.env.SUPER_ADMIN_NOMBRE_USUARIO ?? 'superadmin');
const nombre = Bun.env.SUPER_ADMIN_NOMBRE?.trim() || 'Super administrador';
const correo = normalizarCorreo(Bun.env.SUPER_ADMIN_CORREO);

const ejecutar = async () => {
  const existente = await prisma.usuario.findFirst({
    where: { rol: RolUsuario.SUPER_ADMIN, activo: true },
    select: { id: true, nombreUsuario: true, correo: true },
  });

  if (existente) {
    console.log('Ya existe un SUPER_ADMIN activo.');
    console.log(`Usuario: ${existente.nombreUsuario}`);
    if (existente.correo) console.log(`Correo: ${existente.correo}`);
    return;
  }

  const contrasenaTemporal = generarTokenSeguro(16);
  const usuario = await prisma.usuario.create({
    data: {
      nombreUsuario,
      correo,
      nombre,
      hashContrasena: await hashContrasena(contrasenaTemporal),
      rol: RolUsuario.SUPER_ADMIN,
      debeCambiarContrasena: true,
    },
    select: { id: true, nombreUsuario: true, correo: true },
  });

  console.log('SUPER_ADMIN creado.');
  console.log(`Id: ${usuario.id}`);
  console.log(`Usuario: ${usuario.nombreUsuario}`);
  if (usuario.correo) console.log(`Correo: ${usuario.correo}`);
  console.log(`Contrasena temporal: ${contrasenaTemporal}`);
};

try {
  await ejecutar();
} finally {
  await cerrarPrisma();
}
