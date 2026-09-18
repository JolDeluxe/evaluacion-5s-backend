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

const normalizarCodigo = (c: string) => (c ?? '').trim().toUpperCase().replace(/[\s-]/g, '');

async function validar() {
  console.log('=============================================================================');
  console.log(' VALIDACIÓN POSTERIOR DE ÁREAS Y CÓDIGOS QR (SOLO LECTURA)');
  console.log('=============================================================================\n');

  const snapshotPath = resolve(__dirname, 'data', 'areas-5s.json');
  const snapshot: SnapshotArea[] = JSON.parse(readFileSync(snapshotPath, 'utf-8'));

  const areasBD = await prisma.area.findMany({
    orderBy: { id: 'asc' },
    select: {
      id: true,
      codigo: true,
      nombre: true,
      tipo: true,
      activo: true,
      codigoVerificacion: true,
    },
  });

  let errores = 0;

  // 1. Número total de áreas
  console.log(`1. Conteo de áreas:`);
  console.log(`   - En Base de Datos: ${areasBD.length}`);
  console.log(`   - Esperadas en Snapshot: ${snapshot.length}`);
  if (areasBD.length < snapshot.length) {
    console.error(`   [ERROR] Faltan áreas en la base de datos.`);
    errores++;
  } else {
    console.log(`   [OK] Conteo base satisfecho.`);
  }

  // 2. Número de activas / inactivas
  const activasBD = areasBD.filter((a) => a.activo).length;
  const inactivasBD = areasBD.filter((a) => !a.activo).length;
  console.log(`\n2. Estado operativo:`);
  console.log(`   - Activas en BD: ${activasBD} (Esperadas: 30)`);
  console.log(`   - Inactivas en BD: ${inactivasBD} (Esperadas: 1)`);

  // 3. Ausencia de códigos duplicados
  console.log(`\n3. Unicidad de campos clave:`);
  const mapaCodigos = new Map<string, number>();
  const mapaCv = new Map<string, number>();

  for (const a of areasBD) {
    const cod = a.codigo.trim().toUpperCase();
    const cv = normalizarCodigo(a.codigoVerificacion);
    mapaCodigos.set(cod, (mapaCodigos.get(cod) ?? 0) + 1);
    mapaCv.set(cv, (mapaCv.get(cv) ?? 0) + 1);
  }

  let dupsCodigo = 0;
  for (const [cod, cant] of mapaCodigos) {
    if (cant > 1) {
      console.error(`   [ERROR] Código duplicado en BD: '${cod}' aparece ${cant} veces.`);
      dupsCodigo++;
      errores++;
    }
  }
  if (dupsCodigo === 0) console.log(`   [OK] Cero códigos duplicados.`);

  let dupsCv = 0;
  for (const [cv, cant] of mapaCv) {
    if (cant > 1) {
      console.error(`   [ERROR] codigoVerificacion duplicado en BD: '${cv}' aparece ${cant} veces.`);
      dupsCv++;
      errores++;
    }
  }
  if (dupsCv === 0) console.log(`   [OK] Cero codigoVerificacion duplicados.`);

  // 4. Verificación uno a uno contra el snapshot (Preservación del QR físico)
  console.log(`\n4. Verificación de Preservación de Códigos QR Físicos (31 áreas):`);
  const mapaBDporCodigo = new Map(areasBD.map((a) => [a.codigo.trim().toUpperCase(), a]));

  console.log(`   ┌────────────────────┬────────────────┬────────┬──────────────────┬─────────────────────────────┐`);
  console.log(`   │ CÓDIGO             │ TIPO           │ ACTIVO │ QR FÍSICO (CV)   │ ESTADO RESOLVER             │`);
  console.log(`   ├────────────────────┼────────────────┼────────┼──────────────────┼─────────────────────────────┤`);

  for (const item of snapshot) {
    const aBD = mapaBDporCodigo.get(item.codigo.trim().toUpperCase());
    if (!aBD) {
      console.log(`   │ ${item.codigo.padEnd(18)} │ ${item.tipo.padEnd(14)} │ ${String(item.activo).padEnd(6)} │ ${item.codigoVerificacion.padEnd(16)} │ [MISSING] NO EXISTE         │`);
      errores++;
      continue;
    }

    const cvCoincide = normalizarCodigo(aBD.codigoVerificacion) === normalizarCodigo(item.codigoVerificacion);
    const nombreCoincide = aBD.nombre.trim() === item.nombre.trim();
    const tipoCoincide = aBD.tipo === item.tipo;
    const activoCoincide = aBD.activo === item.activo;

    let resolverStatus = 'MATCH / OK';
    if (!cvCoincide) {
      resolverStatus = 'CONFLICT: QR DIFERENTE';
      errores++;
    } else if (!nombreCoincide || !tipoCoincide || !activoCoincide) {
      resolverStatus = 'AVISO: METADATO DIFIERE';
    }

    console.log(
      `   │ ${aBD.codigo.padEnd(18)} │ ${aBD.tipo.padEnd(14)} │ ${String(aBD.activo).padEnd(6)} │ ${aBD.codigoVerificacion.padEnd(16)} │ ${resolverStatus.padEnd(27)} │`,
    );
  }
  console.log(`   └────────────────────┴────────────────┴────────┴──────────────────┴─────────────────────────────┘`);

  console.log(`\n=============================================================================`);
  if (errores === 0) {
    console.log(`RESULTADO: VALIDACIÓN 100% EXITOSA. Todos los códigos QR físicos coinciden exactamente.`);
  } else {
    console.error(`RESULTADO: FALLÓ LA VALIDACIÓN con ${errores} errores detectados.`);
    process.exit(1);
  }
}

validar()
  .catch((e) => {
    console.error('Error fatal durante la validación:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
