import { prisma } from '../src/db';
import { RolUsuario } from '../src/generated/prisma/enums';
import { normalizarCorreo, normalizarNombreUsuario } from '../src/utils/crypto';
import { USUARIOS_MIGRACION, USUARIOS_EXISTENTES_PRODUCCION } from './migrar-usuarios-produccion';

async function validar() {
  console.log('=============================================================================');
  console.log(' VALIDACIÓN POSTERIOR DE USUARIOS EN BASE DE DATOS (SOLO LECTURA)');
  console.log('=============================================================================\n');

  const usuariosBD = await prisma.usuario.findMany({
    orderBy: { id: 'asc' },
    select: {
      id: true,
      nombreUsuario: true,
      nombre: true,
      correo: true,
      rol: true,
      activo: true,
      debeCambiarContrasena: true,
      esComodin: true,
      puedeSerAsignadoAuditoria: true,
      seEvalua: true,
    },
  });

  console.log(`Total de usuarios registrados en la base de datos: ${usuariosBD.length}\n`);

  let errores = 0;
  let advertencias = 0;

  const mapaPorUsername = new Map(
    usuariosBD.map((u) => [normalizarNombreUsuario(u.nombreUsuario), u]),
  );

  // 1. Validar usuarios existentes previos y que sus roles críticos se hayan preservado intactos
  console.log('1. Verificación de usuarios existentes previos (Roles y Estados preservados):');
  for (const username of USUARIOS_EXISTENTES_PRODUCCION) {
    const u = mapaPorUsername.get(normalizarNombreUsuario(username));
    if (!u) {
      console.log(`   [INFO] Usuario previo '${username}' no está presente en esta BD.`);
      continue;
    }

    // Comprobaciones específicas de integridad
    if (username === 'germain.funes' && u.rol !== RolUsuario.VISUALIZADOR) {
      console.error(`   ❌ [ERROR] germain.funes tiene rol '${u.rol}' pero DEBE ser VISUALIZADOR.`);
      errores++;
    } else if (username === 'ishelhernandez' && u.rol !== RolUsuario.ADMINISTRADOR) {
      console.error(`   ❌ [ERROR] ishelhernandez tiene rol '${u.rol}' pero DEBE ser ADMINISTRADOR.`);
      errores++;
    } else {
      console.log(`   ✓ [OK] ${u.nombreUsuario.padEnd(18)} | ID: ${String(u.id).padStart(3)} | Rol: ${u.rol.padEnd(14)} | Activo: ${u.activo}`);
    }
  }

  // 2. Validar los 32 usuarios migrados esperados
  console.log(`\n2. Verificación de los 32 usuarios migrados (Rol AUDITOR, activo=true, debeCambiarContrasena=true):`);
  console.log(`   ┌──────┬──────────────────────┬──────────────────────────┬──────────────────────────────────────┬─────────┬────────┬──────────────┐`);
  console.log(`   │ ID   │ USERNAME             │ NOMBRE                   │ CORREO                               │ ROL     │ ACTIVO │ DEBE CAMBIAR │`);
  console.log(`   ├──────┼──────────────────────┼──────────────────────────┼──────────────────────────────────────┼─────────┼────────┼──────────────┤`);

  let migradosPresentes = 0;

  for (const esp of USUARIOS_MIGRACION) {
    const usernameNorm = normalizarNombreUsuario(esp.nombreUsuario);
    const u = mapaPorUsername.get(usernameNorm);

    if (!u) {
      console.error(`   │ FALT │ ${esp.nombreUsuario.padEnd(20)} │ ${esp.nombre.padEnd(24)} │ [NO ENCONTRADO EN LA BD]             │ ----    │ ----   │ ----         │`);
      errores++;
      continue;
    }

    migradosPresentes++;
    const correoMatch = normalizarCorreo(u.correo) === normalizarCorreo(esp.correo);
    const rolMatch = u.rol === esp.rol;
    const activoMatch = u.activo === true;
    const debeCambiarMatch = u.debeCambiarContrasena === true;

    const idStr = String(u.id).padStart(4);
    const userStr = u.nombreUsuario.padEnd(20);
    const nomStr = u.nombre.slice(0, 24).padEnd(24);
    const correoStr = (u.correo ?? '— (NULL)').slice(0, 36).padEnd(36);
    const rolStr = u.rol.padEnd(7);
    const actStr = u.activo ? 'SI    ' : 'NO    ';
    const chgStr = u.debeCambiarContrasena ? 'SI          ' : 'NO          ';

    console.log(`   │ ${idStr} │ ${userStr} │ ${nomStr} │ ${correoStr} │ ${rolStr} │ ${actStr} │ ${chgStr} │`);

    if (!correoMatch) {
      console.error(`     ❌ [ERROR CORREO] ${esp.nombreUsuario}: esperado='${esp.correo}', actual en BD='${u.correo}'`);
      errores++;
    }
    if (!rolMatch) {
      console.error(`     ❌ [ERROR ROL] ${esp.nombreUsuario}: esperado='${esp.rol}', actual en BD='${u.rol}'`);
      errores++;
    }
    if (!activoMatch) {
      console.error(`     ❌ [ERROR ACTIVO] ${esp.nombreUsuario}: activo debe ser true`);
      errores++;
    }
    if (!debeCambiarMatch) {
      console.warn(`     ⚠️ [AVISO] ${esp.nombreUsuario}: debeCambiarContrasena es false`);
      advertencias++;
    }
  }
  console.log(`   └──────┴──────────────────────┴──────────────────────────┴──────────────────────────────────────┴─────────┴────────┴──────────────┘\n`);

  // 3. Verificación de unicidad de correos en la base de datos
  console.log('3. Verificación de unicidad de correos electrónicos en BD:');
  const contadorCorreos = new Map<string, string[]>();
  for (const u of usuariosBD) {
    if (u.correo) {
      const c = normalizarCorreo(u.correo)!;
      const arr = contadorCorreos.get(c) ?? [];
      arr.push(u.nombreUsuario);
      contadorCorreos.set(c, arr);
    }
  }

  let correosDuplicados = 0;
  for (const [correo, usuarios] of contadorCorreos) {
    if (usuarios.length > 1) {
      console.error(`   ❌ [ERROR CORREO DUPLICADO] '${correo}' usado por: ${usuarios.join(', ')}`);
      correosDuplicados++;
      errores++;
    }
  }
  if (correosDuplicados === 0) {
    console.log('   ✓ [OK] Cero colisiones de correos electrónicos en la base de datos.');
  }

  // 4. Verificación de nombres de usuario únicos
  console.log('\n4. Verificación de unicidad de nombres de usuario:');
  const contadorUsernames = new Map<string, number>();
  for (const u of usuariosBD) {
    const un = normalizarNombreUsuario(u.nombreUsuario);
    contadorUsernames.set(un, (contadorUsernames.get(un) ?? 0) + 1);
  }

  let usernamesDuplicados = 0;
  for (const [un, cant] of contadorUsernames) {
    if (cant > 1) {
      console.error(`   ❌ [ERROR USERNAME DUPLICADO] '${un}' aparece ${cant} veces.`);
      usernamesDuplicados++;
      errores++;
    }
  }
  if (usernamesDuplicados === 0) {
    console.log('   ✓ [OK] Cero colisiones de nombres de usuario.');
  }

  // 5. Resumen final de validación
  console.log('\n=============================================================================');
  console.log(' RESUMEN DE VALIDACIÓN');
  console.log('=============================================================================');
  console.log(`Usuarios migrados encontrados: ${migradosPresentes} de 32 esperados`);
  console.log(`Errores encontrados:           ${errores}`);
  console.log(`Advertencias:                  ${advertencias}`);

  if (errores === 0) {
    console.log('\n✅ VALIDACIÓN EXITOSA: La base de datos contiene los usuarios esperados con la configuración correcta.');
    console.log('=============================================================================\n');
  } else {
    console.error(`\n❌ VALIDACIÓN CON FALLAS: Se detectaron ${errores} errores en la validación.`);
    console.log('=============================================================================\n');
    process.exit(1);
  }
}

validar()
  .catch((err) => {
    console.error('\n❌ ERROR DURANTE LA VALIDACIÓN:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
