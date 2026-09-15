/**
 * reset-y-sembrar-bd.ts
 *
 * Paso 1: Limpia TODA la BD dejando solo:
 *   - El superadmin existente
 *   - Formularios / versiones / secciones / preguntas
 *   - SecretoSistema, DiaInhabil
 *
 * Paso 2: Crea las 31 áreas nuevas con nomenclatura oficial.
 *
 * Paso 3: Crea los 38 usuarios con contraseña 123456789
 *         y los vincula a sus áreas mediante usuario_area.
 *
 * Uso:
 *   bun run scripts/reset-y-sembrar-bd.ts          # Dry-run (solo muestra)
 *   bun run scripts/reset-y-sembrar-bd.ts --apply  # Aplica cambios
 */

import { randomBytes } from 'node:crypto';

import { prisma } from '../src/db';
import { prepararCamposContrasena } from '../src/utils/cifrado-credencial';
import { RolUsuario, TipoArea } from '../src/generated/prisma/enums';

const APPLY = process.argv.includes('--apply');
const CONTRASENA = '123456789';

// ─────────────────────────────────────────────────────────────────
// ÁREAS OFICIALES
// ─────────────────────────────────────────────────────────────────
//
// Formato: [codigo_corto, nombre_oficial, tipo]
// El código debe ser único y <= 50 chars.

type DefinicionArea = {
  codigo: string;
  nombre: string;
  tipo: TipoArea;
  activo?: boolean;
  auditableDesde?: Date | null;
  auditableHasta?: Date | null;
};

const AREAS: DefinicionArea[] = [
  // ADMINISTRATIVAS
  { codigo: 'ADM-FAC-OMEGA',   nombre: 'ADMINISTRACION - FACTURACION OMEGA',                                                                                tipo: TipoArea.ADMINISTRATIVA },
  { codigo: 'IMG-DISENO',       nombre: 'IMAGEN - DISEÑO',                                                                                                   tipo: TipoArea.ADMINISTRATIVA },
  { codigo: 'CH-OFICINA-KAPPA', nombre: 'CAPITAL HUMANO - OFICINA DE GTE CH - CONSULTORIO KAPPA - VIGILANCIAS DE KAPPA',                                     tipo: TipoArea.ADMINISTRATIVA },
  { codigo: 'DIR-PPCP-MAQ',     nombre: 'DIRECCION - PPCP - MAQUILAS',                                                                                       tipo: TipoArea.ADMINISTRATIVA },
  { codigo: 'ALM-PIELES',       nombre: 'ALMACEN DE PIELES',                                                                                                 tipo: TipoArea.OPERATIVA },
  { codigo: 'ALM-MP',           nombre: 'ALMACEN DE MATERIA PRIMA',                                                                                         tipo: TipoArea.OPERATIVA },
  { codigo: 'OFC-CALIDAD-TI',   nombre: 'OFICINA CALIDAD - TECNOLOGIAS DE INFORMACION',                                                                     tipo: TipoArea.ADMINISTRATIVA },
  { codigo: 'OFC-PESPUNTE-ACC', nombre: 'OFICINA PESPUNTE - OFICINA DE ACCESORIOS - OFICINA DE ADORNO',                                                      tipo: TipoArea.ADMINISTRATIVA },
  { codigo: 'OFC-DES-ING',      nombre: 'OFICINA DESARROLLO BOTA & ACCESORIOS - IMPLEMENTACIONES - INGENIERIA DE COSTOS Y PROCESOS',                         tipo: TipoArea.ADMINISTRATIVA },
  { codigo: 'OFC-SIGMA-VIG',    nombre: 'OFICINA DE SIGMA - VIGILANCIA SIGMA',                                                                              tipo: TipoArea.ADMINISTRATIVA },
  { codigo: 'OFC-BOLSAS-RH',    nombre: 'OFICINA BOLSAS - CONSULTORIO BOLSAS - VIGILANCIA BOLSAS - OFICINA DE RH EN BOLSAS',                                tipo: TipoArea.ADMINISTRATIVA },
  { codigo: 'CELULA-DES',       nombre: 'CELULA DE DESARROLLO',                                                                                              tipo: TipoArea.ADMINISTRATIVA },
  { codigo: 'ALM-PT-DEV',       nombre: 'ALMACEN DE PT - DEVOLUCIONES',                                                                                     tipo: TipoArea.OPERATIVA },
  { codigo: 'OFC-LOG-VIG-REC',  nombre: 'OFICINA DE LOGISTICA - VIGILANCIA OMEGA - RECEPCION OMEGA',                                                         tipo: TipoArea.ADMINISTRATIVA },
  // OPERATIVAS
  { codigo: 'CAL-MESAS',        nombre: 'CALIDAD MESAS DE TRABAJO EN PRODUCCION',                                                                           tipo: TipoArea.OPERATIVA },
  { codigo: 'MTTO',             nombre: 'MANTENIMIENTO KAPPA - SIGMA - LAMBDA',                                                                              tipo: TipoArea.OPERATIVA },
  { codigo: 'MAQ-BETA7',        nombre: 'MAQUILAS BETA 7',                                                                                                  tipo: TipoArea.OPERATIVA },
  { codigo: 'CORTE',            nombre: 'CORTE',                                                                                                             tipo: TipoArea.OPERATIVA },
  { codigo: 'PESPUNTE',         nombre: 'PESPUNTE',                                                                                                         tipo: TipoArea.OPERATIVA },
  {
    codigo: 'PRELIM-KAPPA',
    nombre: 'PRELIMINARES KAPPA',
    tipo: TipoArea.OPERATIVA,
    activo: false,
    auditableHasta: new Date('2026-08-31T23:59:59.999Z'),
  },
  { codigo: 'BORDADO',          nombre: 'BORDADO',                                                                                                           tipo: TipoArea.OPERATIVA },
  { codigo: 'LASER',            nombre: 'LASER',                                                                                                             tipo: TipoArea.OPERATIVA },
  { codigo: 'PRELIM-SIGMA',     nombre: 'PRELIMINARES SIGMA',                                                                                               tipo: TipoArea.OPERATIVA },
  { codigo: 'MONTADO',          nombre: 'MONTADO',                                                                                                           tipo: TipoArea.OPERATIVA },
  { codigo: 'ACABADO',          nombre: 'ACABADO',                                                                                                           tipo: TipoArea.OPERATIVA },
  { codigo: 'AVIO',             nombre: 'AVIO',                                                                                                              tipo: TipoArea.OPERATIVA },
  { codigo: 'ADORNO',           nombre: 'ADORNO',                                                                                                            tipo: TipoArea.OPERATIVA },
  { codigo: 'CINTOS',           nombre: 'CINTOS',                                                                                                            tipo: TipoArea.OPERATIVA },
  { codigo: 'CHAMARRAS',        nombre: 'CHAMARRAS',                                                                                                         tipo: TipoArea.OPERATIVA },
  { codigo: 'BILLETERA',        nombre: 'BILLETERA',                                                                                                         tipo: TipoArea.OPERATIVA },
  { codigo: 'BOLSAS',           nombre: 'BOLSAS',                                                                                                            tipo: TipoArea.OPERATIVA },
];

// ─────────────────────────────────────────────────────────────────
// USUARIOS
// ─────────────────────────────────────────────────────────────────

type DefinicionUsuario = {
  nombre: string;
  nombreUsuario: string;
  correo: string | null;
  areas: string[]; // códigos de área
};

const USUARIOS: DefinicionUsuario[] = [
  {
    nombre: 'GERMAIN FUNES',
    nombreUsuario: 'germain.funes',
    correo: 'germain.funes@cuadra.com.mx',
    areas: ['CAL-MESAS', 'OFC-CALIDAD-TI', 'ADM-FAC-OMEGA'],
  },
  {
    nombre: 'LUCÍA FRANCO',
    nombreUsuario: 'lucia.franco',
    correo: 'admon@cuadra.com.mx',
    areas: ['ADM-FAC-OMEGA'],
  },
  {
    nombre: 'EMMA TAPIA',
    nombreUsuario: 'emma.tapia',
    correo: 'contabilidad@cuadra.com.mx',
    areas: ['ADM-FAC-OMEGA'],
  },
  {
    nombre: 'NORMA LÓPEZ',
    nombreUsuario: 'norma.lopez',
    correo: 'diseno@cuadra.com.mx',
    areas: ['IMG-DISENO'],
  },
  {
    nombre: 'EMMA CASTAÑEDA',
    nombreUsuario: 'emma.castaneda',
    correo: 'aux_diseno2@cuadra.com.mx',
    areas: ['IMG-DISENO'],
  },
  {
    nombre: 'JORGE MACÍAS',
    nombreUsuario: 'jorge.macias',
    correo: 'ppcp_acc@cuadra.com.mx',
    areas: ['DIR-PPCP-MAQ'],
  },
  {
    nombre: 'BLENDA RODRÍGUEZ',
    nombreUsuario: 'blenda.rodriguez',
    correo: 'jefaturacapitalhumano@cuadra.com.mx',
    areas: ['CH-OFICINA-KAPPA'],
  },
  {
    nombre: 'BRANDON DÍAZ',
    nombreUsuario: 'brandon.diaz',
    correo: 'seguridadehigiene.mbc@cuadra.com.mx',
    areas: ['CH-OFICINA-KAPPA'],
  },
  {
    nombre: 'RICARDO MURILLO',
    nombreUsuario: 'ricardo.murillo',
    correo: 'compras_pieles@cuadra.com.mx',
    areas: ['ALM-PIELES'],
  },
  {
    nombre: 'VALERIA CISNEROS',
    nombreUsuario: 'valeria.cisneros',
    correo: 'compras_mp@cuadra.com.mx',
    areas: ['ALM-MP'],
  },
  {
    nombre: 'PAZ LUNA',
    nombreUsuario: 'paz.luna',
    correo: 'pluna@cuadra.com.mx',
    areas: ['DIR-PPCP-MAQ'],
  },
  {
    nombre: 'RODRIGO CORREA',
    nombreUsuario: 'rodrigo.correa',
    correo: 'ingenieria@cuadra.com.mx',
    areas: ['OFC-DES-ING'],
  },
  {
    nombre: 'KAREN LIMÓN',
    nombreUsuario: 'karen.limon',
    correo: 'ingprocesos2_mbc@cuadra.com.mx',
    areas: ['OFC-DES-ING'],
  },
  {
    nombre: 'CARLOS VILLEGAS',
    nombreUsuario: 'carlos.villegas',
    correo: 'mantenimiento2@cuadra.com.mx',
    areas: ['MTTO'],
  },
  {
    nombre: 'ISAAC ARRIAGA',
    nombreUsuario: 'isaac.arriaga',
    correo: 'corte_cuadra@cuadra.com.mx',
    areas: ['CORTE'],
  },
  {
    nombre: 'JOSÉ ALCALÁ',
    nombreUsuario: 'jose.alcala',
    correo: 'pespunte_celula@cuadra.com.mx',
    areas: ['PESPUNTE'],
  },
  {
    nombre: 'GUSTAVO SÁNCHEZ',
    nombreUsuario: 'gustavo.sanchez',
    correo: null,
    areas: ['MONTADO'],
  },
  {
    nombre: 'MARIO RAMÍREZ',
    nombreUsuario: 'mario.ramirez',
    correo: 'acabado_mbc@cuadra.com.mx',
    areas: ['ACABADO'],
  },
  {
    nombre: 'NAYIR ALDANA',
    nombreUsuario: 'nayir.aldana',
    correo: null,
    areas: ['ACABADO'],
  },
  {
    nombre: 'CECILIA ALCÁNTAR',
    nombreUsuario: 'cecilia.alcantar',
    correo: null,
    areas: ['ADORNO'],
  },
  {
    nombre: 'SUSANA REA',
    nombreUsuario: 'susana.rea',
    correo: null,
    areas: ['ADORNO'],
  },
  {
    nombre: 'ARTURO HERNÁNDEZ',
    nombreUsuario: 'arturo.hernandez',
    correo: 'cintos_acc@cuadra.com.mx',
    areas: ['CINTOS'],
  },
  {
    nombre: 'FERNANDO CASTILLO',
    nombreUsuario: 'fernando.castillo',
    correo: 'chamarras_acc@cuadra.com.mx',
    areas: ['CHAMARRAS'],
  },
  {
    nombre: 'ADRIÁN ZAMBRANO',
    nombreUsuario: 'adrian.zambrano',
    correo: 'centroanalisis2@cuadra.com.mx',
    areas: ['OFC-LOG-VIG-REC'],
  },
  {
    nombre: 'ARMANDO RAMÍREZ',
    nombreUsuario: 'armando.ramirez',
    correo: 'productoterminado@cuadra.com.mx',
    areas: ['ALM-PT-DEV'],
  },
  {
    nombre: 'RAÚL HERNÁNDEZ',
    nombreUsuario: 'raul.hernandez',
    correo: 'calidad_mbc@cuadra.com.mx',
    areas: ['CAL-MESAS', 'OFC-CALIDAD-TI'],
  },
  {
    nombre: 'VÍCTOR DE HARO',
    nombreUsuario: 'victor.deharo',
    correo: 'calidad2_mbc@cuadra.com.mx',
    areas: ['CAL-MESAS', 'OFC-CALIDAD-TI'],
  },
  {
    nombre: 'ROBERTO TORRES',
    nombreUsuario: 'roberto.torres',
    correo: 'roberto.torres@cuadra.com.mx',
    areas: ['CAL-MESAS', 'OFC-CALIDAD-TI'],
  },
  {
    nombre: 'RICARDO OJEDA',
    nombreUsuario: 'ricardo.ojeda',
    correo: 'calidad_autoinspeccion@cuadra.com.mx',
    areas: ['CAL-MESAS', 'OFC-CALIDAD-TI'],
  },
  {
    nombre: 'JORGE ESPINOSA',
    nombreUsuario: 'jorge.espinosa',
    correo: 'produccion3_mbc@cuadra.com.mx',
    areas: ['CORTE', 'BORDADO', 'LASER', 'PRELIM-SIGMA', 'PESPUNTE', 'OFC-PESPUNTE-ACC', 'OFC-SIGMA-VIG'],
  },
  {
    nombre: 'CARMEN GODÍNEZ',
    nombreUsuario: 'carmen.godinez',
    correo: 'preliminares_cuadra@cuadra.com.mx',
    areas: ['BORDADO', 'LASER', 'PRELIM-SIGMA', 'OFC-SIGMA-VIG'],
  },
  {
    // Fernando Ramos #1 — Montado/Acabado/Adorno
    nombre: 'FERNANDO RAMOS',
    nombreUsuario: 'fernando.ramos',
    correo: null,
    areas: ['MONTADO', 'ACABADO', 'ADORNO', 'OFC-PESPUNTE-ACC'],
  },
  {
    nombre: 'AGUSTÍN ACOSTA',
    nombreUsuario: 'agustin.acosta',
    correo: 'produccion_acc@cuadra.com.mx',
    areas: ['CINTOS', 'BILLETERA', 'CHAMARRAS', 'BOLSAS', 'OFC-PESPUNTE-ACC', 'OFC-BOLSAS-RH'],
  },
  {
    nombre: 'CRISTÓBAL BAUTISTA',
    nombreUsuario: 'cristobal.bautista',
    correo: 'billeteras_acc@cuadra.com.mx',
    areas: ['BILLETERA', 'OFC-BOLSAS-RH'],
  },
  {
    nombre: 'JUAN CASTILLO',
    nombreUsuario: 'juan.castillo',
    correo: null,
    areas: ['BOLSAS', 'OFC-BOLSAS-RH'],
  },
  {
    // Fernando Ramos #2 — Maquilas/Avio
    nombre: 'FERNANDO RAMOS',
    nombreUsuario: 'fernando.ramos2',
    correo: null,
    areas: ['MAQ-BETA7', 'AVIO', 'DIR-PPCP-MAQ'],
  },
  {
    nombre: 'SERGIO ARENAS',
    nombreUsuario: 'sergio.arenas',
    correo: 'ingprocesos4_mbc@cuadra.com.mx',
    areas: ['CELULA-DES', 'OFC-DES-ING'],
  },
  {
    nombre: 'ALMA MARTÍNEZ',
    nombreUsuario: 'alma.martinez',
    correo: 'ingenieria_acc@cuadra.com.mx',
    areas: ['CELULA-DES', 'OFC-DES-ING'],
  },
  {
    nombre: 'LUIS HERNÁNDEZ',
    nombreUsuario: 'luis.hernandez',
    correo: 'logisticacomercial@cuadra.com.mx',
    areas: ['ALM-PT-DEV', 'OFC-LOG-VIG-REC'],
  },
];

// ─────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────

function generarCodigoVerificacion(): string {
  // 10 chars alfanuméricos aleatorios, mayúsculas
  return randomBytes(8)
    .toString('base64')
    .replace(/[^A-Z0-9]/gi, '')
    .toUpperCase()
    .slice(0, 10)
    .padEnd(10, '0');
}

function log(msg: string) {
  console.log(msg);
}

// ─────────────────────────────────────────────────────────────────
// PASO 1 — LIMPIEZA
// ─────────────────────────────────────────────────────────────────

async function limpiarBd(superAdminId: number) {
  log('\n── PASO 1: LIMPIEZA ─────────────────────────────────────');

  // Orden correcto respetando FKs
  await prisma.fotoAuditoria.deleteMany({});
  log('  ✓ foto_auditoria eliminadas');

  await prisma.respuestaAuditoria.deleteMany({});
  log('  ✓ respuesta_auditoria eliminadas');

  // Nulificar FK circular antes de eliminar envios
  await prisma.objetivoAuditoria.updateMany({
    data: { envioResultadoId: null },
  });
  await prisma.envioAuditoria.deleteMany({});
  log('  ✓ envio_auditoria eliminados');

  await prisma.enlaceInvitado.deleteMany({});
  log('  ✓ enlace_invitado eliminados');

  await prisma.asignacionAuditoria.deleteMany({});
  log('  ✓ asignacion_auditoria eliminadas');

  await prisma.objetivoAuditoria.deleteMany({});
  log('  ✓ objetivo_auditoria eliminados');

  await prisma.asignacionMensual.deleteMany({});
  log('  ✓ asignacion_mensual eliminadas');

  await prisma.cumplimientoMensualArea.deleteMany({});
  log('  ✓ cumplimiento_mensual_area eliminados');

  await prisma.cumplimientoMensualUsuario.deleteMany({});
  log('  ✓ cumplimiento_mensual_usuario eliminados');

  await prisma.delegacionCumplimiento.deleteMany({});
  log('  ✓ delegacion_cumplimiento eliminadas');

  await prisma.usuarioArea.deleteMany({});
  log('  ✓ usuario_area eliminadas');

  await prisma.area.deleteMany({});
  log('  ✓ areas eliminadas');

  // Reasignar formularios y versiones al superadmin para evitar FK violation
  // (formularios.creadoPorId y versiones_formulario.creadoPorId son NOT NULL)
  await prisma.$executeRawUnsafe(
    `UPDATE formularios SET creadoPorId = ? WHERE creadoPorId != ?`,
    superAdminId, superAdminId,
  );
  await prisma.$executeRawUnsafe(
    `UPDATE versiones_formulario SET creadoPorId = ? WHERE creadoPorId != ?`,
    superAdminId, superAdminId,
  );
  log('  ✓ formularios y versiones_formulario reasignados al superadmin');

  // Eliminar usuarios que no son superadmin
  const usuariosAEliminar = await prisma.usuario.findMany({
    where: { id: { not: superAdminId } },
    select: { id: true },
  });

  const idsEliminar = usuariosAEliminar.map((u) => u.id);

  if (idsEliminar.length > 0) {
    await prisma.suscripcionPush.deleteMany({
      where: { usuarioId: { in: idsEliminar } },
    });
    await prisma.entregaNotificacion.deleteMany({
      where: {
        notificacion: { usuarioId: { in: idsEliminar } },
      },
    });
    await prisma.notificacion.deleteMany({
      where: { usuarioId: { in: idsEliminar } },
    });
    await prisma.sesion.deleteMany({
      where: { usuarioId: { in: idsEliminar } },
    });
    await prisma.tokenRestablecimientoContrasena.deleteMany({
      where: { usuarioId: { in: idsEliminar } },
    });
    await prisma.registroAuditoria.deleteMany({
      where: { usuarioId: { in: idsEliminar } },
    });
    await prisma.usuario.deleteMany({
      where: { id: { in: idsEliminar } },
    });
    log(`  ✓ ${idsEliminar.length} usuario(s) eliminados (excepto superadmin)`);
  } else {
    log('  ✓ No había usuarios extra que eliminar');
  }

  // Limpiar también sesiones/notificaciones/tokens del superadmin
  await prisma.suscripcionPush.deleteMany({ where: { usuarioId: superAdminId } });
  await prisma.entregaNotificacion.deleteMany({
    where: { notificacion: { usuarioId: superAdminId } },
  });
  await prisma.notificacion.deleteMany({ where: { usuarioId: superAdminId } });
  await prisma.sesion.deleteMany({ where: { usuarioId: superAdminId } });
  await prisma.tokenRestablecimientoContrasena.deleteMany({ where: { usuarioId: superAdminId } });
  await prisma.registroAuditoria.deleteMany({ where: { usuarioId: superAdminId } });
  log('  ✓ Sesiones, notificaciones y tokens del superadmin limpiados');
}

// ─────────────────────────────────────────────────────────────────
// PASO 2 — CREAR ÁREAS
// ─────────────────────────────────────────────────────────────────

async function crearAreas(): Promise<Map<string, number>> {
  log('\n── PASO 2: CREAR ÁREAS ──────────────────────────────────');

  const codigosVerificacionUsados = new Set<string>();
  const mapaCodigoId = new Map<string, number>();

  for (const def of AREAS) {
    // Generar código de verificación único
    let cv = generarCodigoVerificacion();
    while (codigosVerificacionUsados.has(cv)) {
      cv = generarCodigoVerificacion();
    }
    codigosVerificacionUsados.add(cv);

    if (!APPLY) {
      log(`  [DRY] Área: ${def.nombre} (${def.tipo}) código=${def.codigo} cv=${cv}`);
      mapaCodigoId.set(def.codigo, -1);
      continue;
    }

    const area = await prisma.area.create({
      data: {
        codigo: def.codigo,
        nombre: def.nombre,
        tipo: def.tipo,
        activo: def.activo ?? true,
        auditableDesde: def.auditableDesde ?? null,
        auditableHasta: def.auditableHasta ?? null,
        codigoVerificacion: cv,
      },
    });

    mapaCodigoId.set(def.codigo, area.id);
    log(`  ✓ Área creada: ${area.nombre} (id=${area.id})`);
  }

  return mapaCodigoId;
}

// ─────────────────────────────────────────────────────────────────
// PASO 3 — CREAR USUARIOS + VINCULAR ÁREAS
// ─────────────────────────────────────────────────────────────────

async function crearUsuarios(mapaCodigoId: Map<string, number>) {
  log('\n── PASO 3: CREAR USUARIOS ───────────────────────────────');

  const camposContrasena = await prepararCamposContrasena(CONTRASENA);

  for (const def of USUARIOS) {
    // Verificar que todos los códigos de área existen
    const idsAreas: number[] = [];
    for (const codigo of def.areas) {
      const id = mapaCodigoId.get(codigo);
      if (id === undefined) {
        throw new Error(
          `Usuario "${def.nombre}": código de área desconocido "${codigo}"`,
        );
      }
      idsAreas.push(id);
    }

    if (!APPLY) {
      log(
        `  [DRY] Usuario: ${def.nombre} (${def.nombreUsuario}) ` +
        `correo=${def.correo ?? '—'} areas=[${def.areas.join(', ')}]`,
      );
      continue;
    }

    const usuario = await prisma.usuario.create({
      data: {
        nombre: def.nombre,
        nombreUsuario: def.nombreUsuario,
        correo: def.correo,
        hashContrasena: camposContrasena.hashContrasena,
        credencialCifrada: camposContrasena.credencialCifrada,
        rol: RolUsuario.AUDITOR,
        activo: true,
        debeCambiarContrasena: false,
        esComodin: false,
        puedeSerAsignadoAuditoria: true,
        seEvalua: false,
      },
    });

    // Vincular áreas
    for (const areaId of idsAreas) {
      if (areaId === -1) continue; // dry-run
      await prisma.usuarioArea.create({
        data: {
          usuarioId: usuario.id,
          areaId,
        },
      });
    }

    log(
      `  ✓ Usuario creado: ${usuario.nombre} (id=${usuario.id}) areas=[${def.areas.join(', ')}]`,
    );
  }
}

// ─────────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────────

async function main() {
  console.log('═══════════════════════════════════════════════════════');
  console.log('  RESET Y SIEMBRA DE BD  —  modo:', APPLY ? 'APPLY' : 'DRY-RUN');
  console.log('═══════════════════════════════════════════════════════');

  // Obtener superadmin
  const superAdmin = await prisma.usuario.findFirst({
    where: { activo: true, rol: RolUsuario.SUPER_ADMIN },
    select: { id: true, nombre: true, nombreUsuario: true },
  });

  if (!superAdmin) {
    throw new Error('No se encontró ningún SUPER_ADMIN activo. Abortando.');
  }

  log(`\nSuperadmin encontrado: ${superAdmin.nombre} (id=${superAdmin.id})`);
  log('  Este usuario NO será eliminado.\n');

  if (!APPLY) {
    log('⚠️  Modo DRY-RUN: no se realizará ningún cambio en la BD.');
    log('    Agrega --apply para ejecutar.\n');
  }

  if (APPLY) {
    await prisma.$transaction(async () => {
      await limpiarBd(superAdmin.id);
      const mapaCodigoId = await crearAreas();
      await crearUsuarios(mapaCodigoId);
    }, { timeout: 120_000 });
  } else {
    await limpiarBd(superAdmin.id);
    const mapaCodigoId = await crearAreas();
    await crearUsuarios(mapaCodigoId);
  }

  console.log('\n═══════════════════════════════════════════════════════');
  console.log('  ✅ Completado.');
  console.log('═══════════════════════════════════════════════════════\n');
}

main()
  .catch((err) => {
    console.error('\n❌ ERROR:', err);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
