import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { prisma } from '../src/db';
import { TipoArea } from '../src/generated/prisma/enums';

type SnapshotArea = {
  codigo: string;
  nombre: string;
  tipo: TipoArea;
  activo: boolean;
  auditableDesde: string | null;
  auditableHasta: string | null;
  codigoVerificacion: string;
};

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const DRY_RUN = !APPLY;

const normalizarCodigo = (c: string) => (c ?? '').trim().toUpperCase().replace(/[\s-]/g, '');

async function main() {
  console.log('=============================================================================');
  console.log(' MIGRACIÓN CONTROLADA DE CATÁLOGO DE ÁREAS 5S A PRODUCCIÓN');
  console.log(' Modo:', DRY_RUN ? 'SIMULACIÓN (--dry-run) [NO SE APLICAN CAMBIOS]' : 'EJECUCIÓN REAL (--apply)');
  console.log('=============================================================================\n');

  const snapshotPath = resolve(__dirname, 'data', 'areas-5s.json');
  const snapshot: SnapshotArea[] = JSON.parse(readFileSync(snapshotPath, 'utf-8'));

  console.log(`Snapshot cargado: ${snapshot.length} áreas.`);
  console.log(`  - Activas en snapshot: ${snapshot.filter((a) => a.activo).length}`);
  console.log(`  - Inactivas en snapshot: ${snapshot.filter((a) => !a.activo).length}\n`);

  // 1. Obtener todas las áreas existentes en la base de datos de destino
  const areasDestino = await prisma.area.findMany({
    select: {
      id: true,
      codigo: true,
      nombre: true,
      tipo: true,
      activo: true,
      auditableDesde: true,
      auditableHasta: true,
      codigoVerificacion: true,
    },
  });

  console.log(`Base de datos destino contiene actualmente: ${areasDestino.length} áreas.\n`);

  const mapaDestinoPorCodigo = new Map(areasDestino.map((a) => [a.codigo.trim().toUpperCase(), a]));
  const mapaDestinoPorCv = new Map(areasDestino.map((a) => [normalizarCodigo(a.codigoVerificacion), a]));
  const codigosEnSnapshot = new Set(snapshot.map((s) => s.codigo.trim().toUpperCase()));

  let countMatch = 0;
  let countMissing = 0;
  let countConflict = 0;
  let countExtra = 0;

  const areasAInsertar: SnapshotArea[] = [];
  const mensajesConflicto: string[] = [];

  // 2. Evaluar cada área del snapshot
  for (const item of snapshot) {
    const codSnap = item.codigo.trim().toUpperCase();
    const cvSnapNorm = normalizarCodigo(item.codigoVerificacion);

    const existeMismoCodigo = mapaDestinoPorCodigo.get(codSnap);
    const existeMismoCv = mapaDestinoPorCv.get(cvSnapNorm);

    // CASO C y D: Conflictos de códigoVerificacion
    if (existeMismoCodigo && normalizarCodigo(existeMismoCodigo.codigoVerificacion) !== cvSnapNorm) {
      countConflict++;
      mensajesConflicto.push(
        `[CONFLICTO] El área '${codSnap}' ya existe en destino pero su codigoVerificacion difiere: destino='${existeMismoCodigo.codigoVerificacion}', snapshot='${item.codigoVerificacion}'`,
      );
      continue;
    }

    if (!existeMismoCodigo && existeMismoCv) {
      countConflict++;
      mensajesConflicto.push(
        `[CONFLICTO] El codigoVerificacion '${item.codigoVerificacion}' (de '${codSnap}') ya está ocupado en destino por otra área diferente ('${existeMismoCv.codigo}').`,
      );
      continue;
    }

    if (existeMismoCodigo && existeMismoCv && existeMismoCodigo.id !== existeMismoCv.id) {
      countConflict++;
      mensajesConflicto.push(
        `[CONFLICTO] Inconsistencia cruzada de llaves únicas entre codigo '${codSnap}' y codigoVerificacion '${item.codigoVerificacion}'.`,
      );
      continue;
    }

    // CASO A: Área faltante (MISSING)
    if (!existeMismoCodigo) {
      countMissing++;
      areasAInsertar.push(item);
      console.log(`  [MISSING] ${item.codigo.padEnd(20)} | ${item.tipo.padEnd(15)} | QR: ${item.codigoVerificacion} | ${item.nombre}`);
      continue;
    }

    // CASO B: Existe y coincide (MATCH)
    // Comparar atributos
    let difiereAtributo = false;
    if (existeMismoCodigo.nombre.trim() !== item.nombre.trim()) difiereAtributo = true;
    if (existeMismoCodigo.tipo !== item.tipo) difiereAtributo = true;
    if (existeMismoCodigo.activo !== item.activo) difiereAtributo = true;

    if (difiereAtributo) {
      console.log(`  [EXISTE/AVISO] ${item.codigo.padEnd(20)} | QR MATCH pero difiere algún metadato (nombre/tipo/activo). No se modificará.`);
    } else {
      countMatch++;
      console.log(`  [MATCH]   ${item.codigo.padEnd(20)} | ${item.tipo.padEnd(15)} | QR: ${item.codigoVerificacion} | 100% IDÉNTICO`);
    }
  }

  // 3. Detectar áreas EXTRA en destino que no están en el snapshot
  for (const aDest of areasDestino) {
    if (!codigosEnSnapshot.has(aDest.codigo.trim().toUpperCase())) {
      countExtra++;
      console.log(`  [EXTRA]   ${aDest.codigo.padEnd(20)} (ID: ${aDest.id}) existe en destino pero NO está en el snapshot.`);
    }
  }

  console.log(`\n=============================================================================`);
  console.log(` RESUMEN DE DIAGNÓSTICO`);
  console.log(`=============================================================================`);
  console.log(`  [MATCH]    Coincidencias idénticas: ${countMatch}`);
  console.log(`  [MISSING]  Áreas pendientes por crear: ${countMissing}`);
  console.log(`  [EXTRA]    Áreas adicionales en destino: ${countExtra}`);
  console.log(`  [CONFLICT] Conflictos detectados: ${countConflict}`);

  if (countConflict > 0) {
    console.error('\nCONFLICTOS CRÍTICOS DETECTADOS (OPERACIÓN ABORTADA):');
    for (const msg of mensajesConflicto) {
      console.error(`  - ${msg}`);
    }
    process.exit(1);
  }

  if (countMissing === 0) {
    console.log('\nNO HAY CAMBIOS PENDIENTES: Todas las áreas y sus códigos QR ya existen en destino.');
    return;
  }

  if (DRY_RUN) {
    console.log('\n[SIMULACIÓN FINALIZADA SIN ERRORES]');
    console.log(`Se crearían ${areasAInsertar.length} áreas preservando literalmente sus codigoVerificacion.`);
    console.log('Para aplicar estos cambios en la base de datos configurada, ejecute:');
    console.log('bun run scripts/migrar-areas-produccion.ts --apply\n');
    return;
  }

  // 4. Ejecución real transaccional (--apply)
  console.log(`\nAplicando inserción de ${areasAInsertar.length} áreas dentro de una transacción...`);
  await prisma.$transaction(async (tx) => {
    for (const area of areasAInsertar) {
      const creada = await tx.area.create({
        data: {
          codigo: area.codigo.trim().toUpperCase(),
          nombre: area.nombre.trim(),
          tipo: area.tipo,
          activo: area.activo,
          auditableDesde: area.auditableDesde ? new Date(area.auditableDesde) : null,
          auditableHasta: area.auditableHasta ? new Date(area.auditableHasta) : null,
          codigoVerificacion: area.codigoVerificacion.trim().toUpperCase(), // PRESERVACIÓN LITERAL
        },
      });
      console.log(`  ✓ Creada área '${creada.codigo}' con ID ${creada.id} y QR '${creada.codigoVerificacion}'`);
    }
  });

  console.log('\n[ÉXITO] Migración de áreas completada correctamente.');
}

main()
  .catch((e) => {
    console.error('Error fatal durante la migración de áreas:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
