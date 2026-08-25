import { RolUsuario } from '../src/generated/prisma/enums';
import { prisma, cerrarPrisma } from '../src/db';
import { hashContrasena } from '../src/utils/crypto';
import { registrarAuditoria } from '../src/modules/registros_auditoria/helper';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { randomInt } from 'node:crypto';

const charset = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const generarContrasenaTemporal = (longitud = 18): string => {
  let resultado = '';
  for (let i = 0; i < longitud; i++) {
    resultado += charset[randomInt(0, charset.length)];
  }
  return resultado;
};

const ejecutar = async () => {
  // 1. Buscar SUPER_ADMINs activos
  const superadmins = await prisma.usuario.findMany({
    where: {
      rol: RolUsuario.SUPER_ADMIN,
      activo: true,
    },
    select: {
      id: true,
      nombreUsuario: true,
      nombre: true,
    },
  });

  if (superadmins.length === 0) {
    console.error('No se encontraron usuarios SUPER_ADMIN activos.');
    process.exit(1);
  }

  let targetUser = superadmins[0];

  if (superadmins.length > 1) {
    console.log('Se encontraron múltiples usuarios SUPER_ADMIN activos:');
    for (const sa of superadmins) {
      console.log(`- ${sa.nombreUsuario}`);
    }

    const rl = readline.createInterface({ input, output });
    try {
      const respuesta = await rl.question('Ingrese el nombreUsuario del SUPER_ADMIN a restablecer: ');
      const limpio = respuesta.trim().toLowerCase();
      const match = superadmins.find((sa) => sa.nombreUsuario.toLowerCase() === limpio);
      if (!match) {
        console.error('El usuario ingresado no es un SUPER_ADMIN activo válido. Operación abortada.');
        process.exit(1);
      }
      targetUser = match;
    } finally {
      rl.close();
    }
  }

  // 2. Generar contraseña temporal
  const contrasenaTemporal = generarContrasenaTemporal();

  // 3. Crear hash mediante Bun.password.hash con Argon2id
  const nuevoHash = await hashContrasena(contrasenaTemporal);

  const ahora = new Date();

  // 4. Ejecutar actualizaciones en una transacción
  await prisma.$transaction(async (tx) => {
    // Actualizar usuario
    await tx.usuario.update({
      where: { id: targetUser.id },
      data: {
        hashContrasena: nuevoHash,
        debeCambiarContrasena: true,
        contrasenaCambiadaEn: ahora,
      },
    });

    // Revocar todas las sesiones existentes
    await tx.sesion.updateMany({
      where: {
        usuarioId: targetUser.id,
        revocadoEn: null,
      },
      data: {
        revocadoEn: ahora,
      },
    });

    // Registrar en RegistroAuditoria sin password ni hash
    await registrarAuditoria({
      usuarioId: targetUser.id,
      accion: 'RESTABLECER_CONTRASENA_SUPER_ADMIN',
      tipoEntidad: 'Usuario',
      idEntidad: targetUser.id,
    }, tx);
  });

  // 5. Mostrar la contraseña temporal UNA SOLA VEZ
  console.log(`Contraseña temporal generada: ${contrasenaTemporal}`);
};

try {
  await ejecutar();
} catch (error) {
  console.error('Error al restablecer la contraseña del SUPER_ADMIN:', error);
  process.exit(1);
} finally {
  await cerrarPrisma();
}
