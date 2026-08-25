import { RolUsuario } from '../src/generated/prisma/enums';
import { prisma, cerrarPrisma } from '../src/db';
import {
  generarTokenSeguro,
  hashContrasena,
  normalizarCorreo,
  normalizarNombreUsuario,
} from '../src/utils/crypto';

const nombreUsuario = normalizarNombreUsuario(Bun.env.ADMIN_NOMBRE_USUARIO ?? 'admin');
const nombre = Bun.env.ADMIN_NOMBRE?.trim() || 'Administrador del sistema';
const correo = normalizarCorreo(Bun.env.ADMIN_CORREO);

const ejecutar = async () => {
  const existente = await prisma.usuario.findFirst({
    where: { rol: RolUsuario.ADMINISTRADOR, activo: true },
    select: { id: true, nombreUsuario: true, correo: true },
  });

  if (existente) {
    console.log('Ya existe un administrador activo.');
    console.log(`Usuario: ${existente.nombreUsuario}`);
    if (existente.correo) console.log(`Correo: ${existente.correo}`);
    return;
  }

  const contrasenaTemporal = generarTokenSeguro(12);
  const usuario = await prisma.usuario.create({
    data: {
      nombreUsuario,
      correo,
      nombre,
      hashContrasena: await hashContrasena(contrasenaTemporal),
      rol: RolUsuario.ADMINISTRADOR,
      debeCambiarContrasena: true,
    },
    select: { id: true, nombreUsuario: true, correo: true },
  });

  console.log('Administrador creado.');
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
