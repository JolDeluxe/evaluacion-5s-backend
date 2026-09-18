import { prisma } from '../src/db';
import { RolUsuario } from '../src/generated/prisma/enums';
import { normalizarCorreo, normalizarNombreUsuario, validarContrasena } from '../src/utils/crypto';
import { prepararCamposContrasena } from '../src/utils/cifrado-credencial';

// ---------------------------------------------------------------------------
// Definición de los 32 usuarios a migrar
// ---------------------------------------------------------------------------
export type UsuarioMigracion = {
  nombreUsuario: string;
  nombre: string;
  correo: string | null;
  rol: RolUsuario;
};

export const USUARIOS_MIGRACION: readonly UsuarioMigracion[] = [
  { nombreUsuario: 'jorge.macias', nombre: 'JORGE MACÍAS', correo: 'ppcp_acc@cuadra.com.mx', rol: RolUsuario.AUDITOR },
  { nombreUsuario: 'ricardo.murillo', nombre: 'RICARDO MURILLO', correo: 'compras_pieles@cuadra.com.mx', rol: RolUsuario.AUDITOR },
  { nombreUsuario: 'valeria.cisneros', nombre: 'VALERIA CISNEROS', correo: 'compras_mp@cuadra.com.mx', rol: RolUsuario.AUDITOR },
  { nombreUsuario: 'paz.luna', nombre: 'PAZ LUNA', correo: 'pluna@cuadra.com.mx', rol: RolUsuario.AUDITOR },
  { nombreUsuario: 'rodrigo.correa', nombre: 'RODRIGO CORREA', correo: 'ingenieria@cuadra.com.mx', rol: RolUsuario.AUDITOR },
  { nombreUsuario: 'karen.limon', nombre: 'KAREN LIMÓN', correo: 'ingprocesos2_mbc@cuadra.com.mx', rol: RolUsuario.AUDITOR },
  { nombreUsuario: 'carlos.villegas', nombre: 'CARLOS VILLEGAS', correo: 'mantenimiento2@cuadra.com.mx', rol: RolUsuario.AUDITOR },
  { nombreUsuario: 'isaac.arriaga', nombre: 'ISAAC ARRIAGA', correo: 'corte_cuadra@cuadra.com.mx', rol: RolUsuario.AUDITOR },
  { nombreUsuario: 'jose.alcala', nombre: 'JOSÉ ALCALÁ', correo: 'pespunte_celula@cuadra.com.mx', rol: RolUsuario.AUDITOR },
  { nombreUsuario: 'gustavo.sanchez', nombre: 'GUSTAVO SÁNCHEZ', correo: null, rol: RolUsuario.AUDITOR },
  { nombreUsuario: 'mario.ramirez', nombre: 'MARIO RAMÍREZ', correo: 'acabado_mbc@cuadra.com.mx', rol: RolUsuario.AUDITOR },
  { nombreUsuario: 'nayir.aldana', nombre: 'NAYIR ALDANA', correo: null, rol: RolUsuario.AUDITOR },
  { nombreUsuario: 'cecilia.alcantar', nombre: 'CECILIA ALCÁNTAR', correo: null, rol: RolUsuario.AUDITOR },
  { nombreUsuario: 'susana.rea', nombre: 'SUSANA REA', correo: null, rol: RolUsuario.AUDITOR },
  { nombreUsuario: 'arturo.hernandez', nombre: 'ARTURO HERNÁNDEZ', correo: 'cintos_acc@cuadra.com.mx', rol: RolUsuario.AUDITOR },
  { nombreUsuario: 'fernando.castillo', nombre: 'FERNANDO CASTILLO', correo: 'chamarras_acc@cuadra.com.mx', rol: RolUsuario.AUDITOR },
  { nombreUsuario: 'adrian.zambrano', nombre: 'ADRIÁN ZAMBRANO', correo: 'centroanalisis2@cuadra.com.mx', rol: RolUsuario.AUDITOR },
  { nombreUsuario: 'armando.ramirez', nombre: 'ARMANDO RAMÍREZ', correo: 'productoterminado@cuadra.com.mx', rol: RolUsuario.AUDITOR },
  { nombreUsuario: 'raul.hernandez', nombre: 'RAÚL HERNÁNDEZ', correo: 'calidad_mbc@cuadra.com.mx', rol: RolUsuario.AUDITOR },
  { nombreUsuario: 'victor.deharo', nombre: 'VÍCTOR DE HARO', correo: 'calidad2_mbc@cuadra.com.mx', rol: RolUsuario.AUDITOR },
  { nombreUsuario: 'roberto.torres', nombre: 'ROBERTO TORRES', correo: 'roberto.torres@cuadra.com.mx', rol: RolUsuario.AUDITOR },
  { nombreUsuario: 'ricardo.ojeda', nombre: 'RICARDO OJEDA', correo: 'calidad_autoinspeccion@cuadra.com.mx', rol: RolUsuario.AUDITOR },
  { nombreUsuario: 'jorge.espinosa', nombre: 'JORGE ESPINOSA', correo: 'produccion3_mbc@cuadra.com.mx', rol: RolUsuario.AUDITOR },
  { nombreUsuario: 'carmen.godinez', nombre: 'CARMEN GODÍNEZ', correo: 'preliminares_cuadra@cuadra.com.mx', rol: RolUsuario.AUDITOR },
  { nombreUsuario: 'fernando.ramos', nombre: 'FERNANDO RAMOS', correo: null, rol: RolUsuario.AUDITOR },
  { nombreUsuario: 'agustin.acosta', nombre: 'AGUSTÍN ACOSTA', correo: 'produccion_acc@cuadra.com.mx', rol: RolUsuario.AUDITOR },
  { nombreUsuario: 'cristobal.bautista', nombre: 'CRISTÓBAL BAUTISTA', correo: 'billeteras_acc@cuadra.com.mx', rol: RolUsuario.AUDITOR },
  { nombreUsuario: 'juan.castillo', nombre: 'JUAN CASTILLO', correo: null, rol: RolUsuario.AUDITOR },
  { nombreUsuario: 'fernando.ramos2', nombre: 'FERNANDO RAMOS', correo: null, rol: RolUsuario.AUDITOR },
  { nombreUsuario: 'sergio.arenas', nombre: 'SERGIO ARENAS', correo: 'ingprocesos4_mbc@cuadra.com.mx', rol: RolUsuario.AUDITOR },
  { nombreUsuario: 'alma.martinez', nombre: 'ALMA MARTÍNEZ', correo: 'ingenieria_acc@cuadra.com.mx', rol: RolUsuario.AUDITOR },
  { nombreUsuario: 'luis.hernandez', nombre: 'LUIS HERNÁNDEZ', correo: 'logisticacomercial@cuadra.com.mx', rol: RolUsuario.AUDITOR },
] as const;

// Lista de usuarios existentes conocidos en producción (para verificación/auditoría)
export const USUARIOS_EXISTENTES_PRODUCCION = [
  'superadmin',
  'brandondiaz',
  'ishelhernandez',
  'valeriaaranda',
  'blendarodriguez',
  'germain.funes',
  'lucia.franco',
  'emma.tapia',
  'norma.lopez',
  'emma.castaneda',
] as const;

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const DRY_RUN = !APPLY;

async function main() {
  console.log('=============================================================================');
  console.log(' MIGRACIÓN CONTROLADA DE USUARIOS FALTANTES A PRODUCCIÓN');
  console.log(' Modo:', DRY_RUN ? 'SIMULACIÓN (--dry-run) [NO SE APLICAN CAMBIOS]' : 'EJECUCIÓN REAL (--apply)');
  console.log('=============================================================================\n');

  // 1. Validar variable de entorno obligatoria
  const contrasenaTemporal = process.env.MIGRACION_PASSWORD_TEMPORAL;
  if (!contrasenaTemporal) {
    console.error('❌ ERROR FATAL: La variable de entorno MIGRACION_PASSWORD_TEMPORAL no está definida.');
    console.error('   Debe proporcionar una contraseña temporal segura antes de ejecutar.');
    console.error('   Ejemplo:');
    console.error('     MIGRACION_PASSWORD_TEMPORAL="MiPassSeguro123*" bun run scripts/migrar-usuarios-produccion.ts --dry-run\n');
    process.exit(1);
  }

  const errorPass = validarContrasena(contrasenaTemporal);
  if (errorPass) {
    console.error(`❌ ERROR FATAL: La contraseña temporal en MIGRACION_PASSWORD_TEMPORAL es inválida: ${errorPass}`);
    process.exit(1);
  }

  console.log('✓ Contraseña temporal validada mediante reglas de seguridad de la aplicación.');

  // 2. Consultar usuarios actuales en la base de datos destino
  console.log('Consultando usuarios existentes en la base de datos...');
  const usuariosExistentes = await prisma.usuario.findMany({
    select: {
      id: true,
      nombreUsuario: true,
      correo: true,
      nombre: true,
      rol: true,
      activo: true,
    },
  });

  console.log(`✓ Usuarios encontrados en la base de datos: ${usuariosExistentes.length}\n`);

  // Indexar existentes por nombreUsuario (normalizado) y por correo (normalizado)
  const mapaPorUsername = new Map(
    usuariosExistentes.map((u) => [normalizarNombreUsuario(u.nombreUsuario), u]),
  );

  const mapaPorCorreo = new Map<string, typeof usuariosExistentes[0]>();
  for (const u of usuariosExistentes) {
    if (u.correo) {
      const correoNorm = normalizarCorreo(u.correo);
      if (correoNorm) {
        mapaPorCorreo.set(correoNorm, u);
      }
    }
  }

  // 3. Evaluar cada usuario candidato a migrar
  const omitidos: Array<{ candidato: UsuarioMigracion; motivo: string; usuarioExistente: typeof usuariosExistentes[0] }> = [];
  const porInsertar: UsuarioMigracion[] = [];

  for (const candidato of USUARIOS_MIGRACION) {
    const usernameNorm = normalizarNombreUsuario(candidato.nombreUsuario);
    const correoNorm = normalizarCorreo(candidato.correo);

    // Verificar coincidencia por nombreUsuario
    const coincidenciaUsername = mapaPorUsername.get(usernameNorm);
    if (coincidenciaUsername) {
      omitidos.push({
        candidato,
        motivo: `nombreUsuario '${usernameNorm}' ya existe (ID: ${coincidenciaUsername.id}, Rol: ${coincidenciaUsername.rol})`,
        usuarioExistente: coincidenciaUsername,
      });
      continue;
    }

    // Verificar coincidencia por correo (cuando no es null)
    if (correoNorm) {
      const coincidenciaCorreo = mapaPorCorreo.get(correoNorm);
      if (coincidenciaCorreo) {
        omitidos.push({
          candidato,
          motivo: `correo '${correoNorm}' ya asignado al usuario '${coincidenciaCorreo.nombreUsuario}' (ID: ${coincidenciaCorreo.id})`,
          usuarioExistente: coincidenciaCorreo,
        });
        continue;
      }
    }

    porInsertar.push(candidato);
  }

  // Imprimir reporte de omitidos
  console.log('─────────────────────────────────────────────────────────────────────────────');
  console.log(`USUARIOS QUE YA EXISTEN Y FUERON OMITIDOS (${omitidos.length}):`);
  console.log('─────────────────────────────────────────────────────────────────────────────');
  if (omitidos.length === 0) {
    console.log('  (Ninguno de los 32 usuarios existe previamente en la base de datos)');
  } else {
    for (const item of omitidos) {
      console.log(`  • [OMITIDO] ${item.candidato.nombreUsuario.padEnd(20)} | ${item.motivo}`);
    }
  }
  console.log('');

  // Imprimir reporte de usuarios listos para insertar
  console.log('─────────────────────────────────────────────────────────────────────────────');
  console.log(`USUARIOS PENDIENTES DE INSERTAR (${porInsertar.length} de ${USUARIOS_MIGRACION.length}):`);
  console.log('─────────────────────────────────────────────────────────────────────────────');
  for (const u of porInsertar) {
    console.log(`  + [INSERTAR] ${u.nombreUsuario.padEnd(20)} | ${u.nombre.padEnd(25)} | ${String(u.correo).padEnd(36)} | Rol: ${u.rol}`);
  }
  console.log('');

  if (porInsertar.length === 0) {
    console.log('✓ Todos los usuarios requeridos ya están presentes en la base de datos. No se requiere ninguna acción.');
    return;
  }

  // 4. Ejecución en simulación vs transacción real
  if (DRY_RUN) {
    console.log('=============================================================================');
    console.log(' SIMULACIÓN COMPLETADA (--dry-run)');
    console.log(' No se insertó ningún registro ni se modificó ningún dato en la base.');
    console.log(` Total a insertar en ejecución real: ${porInsertar.length} usuarios.`);
    console.log(' Para aplicar los cambios reales use el flag: --apply');
    console.log('=============================================================================');
    return;
  }

  console.log('Preparando hash y cifrado de credenciales (reutilizando módulo utils/cifrado-credencial)...');
  const camposContrasena = await prepararCamposContrasena(contrasenaTemporal);

  console.log('Iniciando transacción Prisma para inserción atómica de usuarios...');
  const usuariosInsertados = await prisma.$transaction(async (tx) => {
    const insertados: Array<{ id: number; nombreUsuario: string; nombre: string; rol: RolUsuario; correo: string | null }> = [];

    for (const def of porInsertar) {
      const nuevo = await tx.usuario.create({
        data: {
          nombreUsuario: normalizarNombreUsuario(def.nombreUsuario),
          nombre: def.nombre.trim(),
          correo: normalizarCorreo(def.correo),
          rol: def.rol,
          activo: true,
          debeCambiarContrasena: true,
          esComodin: false,
          puedeSerAsignadoAuditoria: true,
          seEvalua: false,
          hashContrasena: camposContrasena.hashContrasena,
          credencialCifrada: camposContrasena.credencialCifrada,
        },
        select: {
          id: true,
          nombreUsuario: true,
          nombre: true,
          rol: true,
          correo: true,
        },
      });

      insertados.push(nuevo);
    }

    return insertados;
  });

  // 5. Reporte final post-inserción
  console.log('\n=============================================================================');
  console.log(' MIGRACIÓN COMPLETADA EXITOSAMENTE');
  console.log('=============================================================================');
  console.log(`Usuarios encontrados previamente:    ${usuariosExistentes.length}`);
  console.log(`Usuarios que ya existían (omitidos):  ${omitidos.length}`);
  console.log(`Usuarios insertados en transacción:  ${usuariosInsertados.length}`);
  console.log(`Total final de usuarios en el sistema: ${usuariosExistentes.length + usuariosInsertados.length}\n`);

  console.log('IDs generados (autoincrementales):');
  for (const u of usuariosInsertados) {
    console.log(`  • ID: ${String(u.id).padStart(4)} | Username: ${u.nombreUsuario.padEnd(20)} | Nombre: ${u.nombre.padEnd(25)} | Rol: ${u.rol}`);
  }
  console.log('=============================================================================\n');
}

if (import.meta.main || process.argv[1]?.includes('migrar-usuarios-produccion')) {
  main()
    .catch((err) => {
      console.error('\n❌ ERROR DURANTE LA MIGRACIÓN:', err);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
