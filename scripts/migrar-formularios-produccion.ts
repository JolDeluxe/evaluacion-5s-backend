import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { prisma } from '../src/db';
import { RolUsuario } from '../src/generated/prisma/enums';

type SnapshotPregunta = {
  claveEstable: string;
  texto: string;
  orden: number;
  requiereHallazgo: boolean;
};

type SnapshotSeccion = {
  claveEstable: string;
  nombre: string;
  objetivo: string | null;
  orden: number;
  preguntas: SnapshotPregunta[];
};

type SnapshotFormulario = {
  formulario: {
    slug: string;
    nombre: string;
    descripcion: string | null;
    alcance: 'ADMINISTRATIVO' | 'OPERATIVO';
    activo: boolean;
  };
  version: {
    numeroVersion: number;
    activa: boolean;
  };
  secciones: SnapshotSeccion[];
};

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const DRY_RUN = !APPLY;

async function main() {
  console.log('=============================================================================');
  console.log(' MIGRACIÓN CONTROLADA DE CATÁLOGO DE FORMULARIOS 5S A PRODUCCIÓN');
  console.log(' Modo:', DRY_RUN ? 'SIMULACIÓN (--dry-run) [NO SE APLICAN CAMBIOS]' : 'EJECUCIÓN REAL (--apply)');
  console.log('=============================================================================\n');

  const snapshotPath = resolve(__dirname, 'data', 'formularios-5s-ultima-version.json');
  const snapshot: SnapshotFormulario[] = JSON.parse(readFileSync(snapshotPath, 'utf-8'));

  // 1. Obtener usuario autor en la base de datos de destino
  const admin = await prisma.usuario.findFirst({
    where: { activo: true, rol: { in: [RolUsuario.SUPER_ADMIN, RolUsuario.ADMINISTRADOR] } },
    orderBy: { id: 'asc' },
    select: { id: true, nombreUsuario: true },
  });

  const autorId = admin?.id ?? 1;
  console.log(`Usuario autor en base destino: ID ${autorId} (${admin?.nombreUsuario ?? 'Default ID 1'})\n`);

  let tieneConflictos = false;
  const operaciones: Array<() => Promise<void>> = [];

  for (const item of snapshot) {
    const { formulario: fData, version: vData, secciones: sData } = item;
    console.log(`-----------------------------------------------------------------------------`);
    console.log(`Formulario: ${fData.nombre} (${fData.slug}) -> Versión Meta: ${vData.numeroVersion}`);

    // Buscar si el formulario raíz existe en destino
    const formExistente = await prisma.formulario.findUnique({
      where: { slug: fData.slug },
      include: {
        versiones: {
          include: {
            secciones: {
              include: { preguntas: true },
            },
          },
        },
      },
    });

    if (!formExistente) {
      console.log(`  [MISSING] Formulario raíz '${fData.slug}' no existe. Se creará.`);
      operaciones.push(async () => {
        const nuevoForm = await prisma.formulario.create({
          data: {
            nombre: fData.nombre,
            slug: fData.slug,
            descripcion: fData.descripcion,
            alcance: fData.alcance,
            activo: true,
            creadoPorId: autorId,
            versiones: {
              create: {
                numeroVersion: vData.numeroVersion,
                activa: false, // NO alterar versiones activas existentes
                creadoPorId: autorId,
                secciones: {
                  create: sData.map((s) => ({
                    claveEstable: s.claveEstable,
                    nombre: s.nombre,
                    objetivo: s.objetivo,
                    orden: s.orden,
                    preguntas: {
                      create: s.preguntas.map((p) => ({
                        claveEstable: p.claveEstable,
                        texto: p.texto,
                        orden: p.orden,
                        requiereHallazgo: p.requiereHallazgo,
                      })),
                    },
                  })),
                },
              },
            },
          },
        });
        console.log(`  -> Creado formulario y versión meta ID: ${nuevoForm.id}`);
      });
      continue;
    }

    console.log(`  [EXISTE] Formulario raíz encontrado (ID: ${formExistente.id}).`);

    // Reportar versiones históricas existentes (se respetan rigurosamente)
    for (const vHist of formExistente.versiones) {
      if (vHist.numeroVersion !== vData.numeroVersion) {
        console.log(`    (Versión histórica V${vHist.numeroVersion} detectada - ID: ${vHist.id}, activa: ${vHist.activa}) -> EXTRA / PRESERVADA`);
      }
    }

    // Buscar si la versión objetivo (ej. V3 o V4) ya existe
    const versionMeta = formExistente.versiones.find((v) => v.numeroVersion === vData.numeroVersion);

    if (!versionMeta) {
      console.log(`  [MISSING] Versión ${vData.numeroVersion} no existe en destino. Se creará con ${sData.length} secciones y ${sData.reduce((a, s) => a + s.preguntas.length, 0)} preguntas.`);
      operaciones.push(async () => {
        const nuevaVersion = await prisma.versionFormulario.create({
          data: {
            formularioId: formExistente.id,
            numeroVersion: vData.numeroVersion,
            activa: false, // NO alterar versiones activas existentes
            creadoPorId: autorId,
            secciones: {
              create: sData.map((s) => ({
                claveEstable: s.claveEstable,
                nombre: s.nombre,
                objetivo: s.objetivo,
                orden: s.orden,
                preguntas: {
                  create: s.preguntas.map((p) => ({
                    claveEstable: p.claveEstable,
                    texto: p.texto,
                    orden: p.orden,
                    requiereHallazgo: p.requiereHallazgo,
                  })),
                },
              })),
            },
          },
        });
        console.log(`  -> Creada versión meta ID: ${nuevaVersion.id}`);
      });
      continue;
    }

    // Si ya existe la versión, verificar si su estructura es exactamente idéntica (MATCH) o distinta (CONFLICT)
    console.log(`  [EXISTE] Versión ${vData.numeroVersion} ya existe en destino (ID: ${versionMeta.id}, activa: ${versionMeta.activa}). Comparando estructura...`);

    let discrepancias = 0;
    const mapaSeccionesDestino = new Map(versionMeta.secciones.map((s) => [s.claveEstable, s]));

    if (versionMeta.secciones.length !== sData.length) {
      console.log(`    [CONFLICT] Conteo de secciones difiere: destino tiene ${versionMeta.secciones.length}, snapshot espera ${sData.length}.`);
      discrepancias++;
    }

    for (const sSnap of sData) {
      const sDest = mapaSeccionesDestino.get(sSnap.claveEstable);
      if (!sDest) {
        console.log(`    [CONFLICT] Sección faltante en destino: '${sSnap.nombre}' (${sSnap.claveEstable}).`);
        discrepancias++;
        continue;
      }

      if (sDest.nombre !== sSnap.nombre) {
        console.log(`    [CONFLICT] Nombre de sección difiere: '${sDest.nombre}' vs esperado '${sSnap.nombre}'.`);
        discrepancias++;
      }

      const mapaPregsDestino = new Map(sDest.preguntas.map((p) => [p.claveEstable, p]));
      for (const pSnap of sSnap.preguntas) {
        const pDest = mapaPregsDestino.get(pSnap.claveEstable);
        if (!pDest) {
          console.log(`    [CONFLICT] Pregunta faltante: ${pSnap.claveEstable} en sección '${sSnap.nombre}'.`);
          discrepancias++;
          continue;
        }
        if (pDest.texto.trim() !== pSnap.texto.trim()) {
          console.log(`    [CONFLICT] Texto de pregunta difiere para ${pSnap.claveEstable}.`);
          discrepancias++;
        }
        if (pDest.requiereHallazgo !== pSnap.requiereHallazgo) {
          console.log(`    [CONFLICT] requiereHallazgo difiere para ${pSnap.claveEstable}: destino=${pDest.requiereHallazgo}, esperado=${pSnap.requiereHallazgo}.`);
          discrepancias++;
        }
      }
    }

    if (discrepancias === 0) {
      console.log(`  [MATCH / OK] La versión ${vData.numeroVersion} ya existe y es 100% IDÉNTICA al snapshot canónico. No requiere cambios.`);
    } else {
      console.log(`  [CONFLICT] Se detectaron ${discrepancias} conflictos en la versión ${vData.numeroVersion}. Por seguridad no se sobrescribirá.`);
      tieneConflictos = true;
    }
  }

  console.log(`\n=============================================================================`);
  console.log(` BALANCE DE OPERACIÓN`);
  console.log(`=============================================================================`);
  console.log(`Operaciones pendientes de inserción: ${operaciones.length}`);
  console.log(`Conflictos detectados: ${tieneConflictos ? 'SÍ (SE DETENDRÁ LA EJECUCIÓN)' : 'NINGUNO'}`);

  if (tieneConflictos) {
    console.error('\nABORTADO: Existen conflictos en versiones preexistentes. Resuelva los conflictos antes de aplicar.');
    process.exit(1);
  }

  if (operaciones.length === 0) {
    console.log('\nNO HAY CAMBIOS PENDIENTES: Todas las versiones objetivo ya están sincronizadas con el snapshot.');
    return;
  }

  if (DRY_RUN) {
    console.log('\n[SIMULACIÓN FINALIZADA]');
    console.log('Para aplicar estos cambios en la base de datos configurada, ejecute:');
    console.log('bun run scripts/migrar-formularios-produccion.ts --apply\n');
    return;
  }

  // Ejecución transaccional real
  console.log('\nAplicando cambios dentro de una transacción...');
  await prisma.$transaction(async () => {
    for (const op of operaciones) {
      await op();
    }
  });

  console.log('\n[ÉXITO] Migración manual completada exitosamente.');
  console.log('Recordatorio: Las versiones se crearon con activa = false para preservar la operación actual.');
}

main()
  .catch((e) => {
    console.error('Error fatal durante la migración:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
