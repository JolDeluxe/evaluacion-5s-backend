import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { prisma } from '../src/db';

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
    alcance: string;
    activo: boolean;
  };
  version: {
    numeroVersion: number;
    activa: boolean;
  };
  secciones: SnapshotSeccion[];
};

async function validar() {
  console.log('=============================================================================');
  console.log(' VALIDACIÓN POSTERIOR DE INTEGRIDAD CONTRA SNAPSHOT CANÓNICO');
  console.log('=============================================================================\n');

  const snapshotPath = resolve(__dirname, 'data', 'formularios-5s-ultima-version.json');
  const snapshot: SnapshotFormulario[] = JSON.parse(readFileSync(snapshotPath, 'utf-8'));

  let totalErrores = 0;

  for (const item of snapshot) {
    const { formulario: fData, version: vData, secciones: sData } = item;
    console.log(`-----------------------------------------------------------------------------`);
    console.log(`Evaluando: ${fData.nombre} (${fData.slug}) - Versión Meta ${vData.numeroVersion}`);

    const dbVersion = await prisma.versionFormulario.findFirst({
      where: {
        formulario: { slug: fData.slug },
        numeroVersion: vData.numeroVersion,
      },
      include: {
        formulario: true,
        secciones: {
          orderBy: { orden: 'asc' },
          include: {
            preguntas: {
              orderBy: { orden: 'asc' },
            },
          },
        },
      },
    });

    if (!dbVersion) {
      console.log(`  [MISSING] La versión ${vData.numeroVersion} no existe en la base de datos.`);
      totalErrores++;
      continue;
    }

    // 1. Validar conteos
    const totalPregsEsperadas = sData.reduce((acc, s) => acc + s.preguntas.length, 0);
    const totalPregsBD = dbVersion.secciones.reduce((acc, s) => acc + s.preguntas.length, 0);

    if (dbVersion.secciones.length === sData.length && totalPregsBD === totalPregsEsperadas) {
      console.log(`  [MATCH] Conteos correctos: ${dbVersion.secciones.length} secciones, ${totalPregsBD} preguntas.`);
    } else {
      console.log(`  [CONFLICT] Conteos incorrectos:`);
      console.log(`    Secciones: BD=${dbVersion.secciones.length}, Esperado=${sData.length}`);
      console.log(`    Preguntas: BD=${totalPregsBD}, Esperado=${totalPregsEsperadas}`);
      totalErrores++;
    }

    // 2. Validar cada sección y pregunta
    const mapaSeccionesBD = new Map(dbVersion.secciones.map((s) => [s.claveEstable, s]));

    for (const sSnap of sData) {
      const sBD = mapaSeccionesBD.get(sSnap.claveEstable);
      if (!sBD) {
        console.log(`  [MISSING] Sección faltante: '${sSnap.nombre}' (${sSnap.claveEstable})`);
        totalErrores++;
        continue;
      }

      if (sBD.nombre !== sSnap.nombre) {
        console.log(`  [CONFLICT] Nombre de sección difiere en ${sSnap.claveEstable}: BD='${sBD.nombre}', Esperado='${sSnap.nombre}'`);
        totalErrores++;
      }

      if (sBD.orden !== sSnap.orden) {
        console.log(`  [CONFLICT] Orden de sección difiere en '${sSnap.nombre}': BD=${sBD.orden}, Esperado=${sSnap.orden}`);
        totalErrores++;
      }

      const mapaPregsBD = new Map(sBD.preguntas.map((p) => [p.claveEstable, p]));

      for (const pSnap of sSnap.preguntas) {
        const pBD = mapaPregsBD.get(pSnap.claveEstable);
        if (!pBD) {
          console.log(`  [MISSING] Pregunta faltante: ${pSnap.claveEstable} en sección '${sSnap.nombre}'`);
          totalErrores++;
          continue;
        }

        if (pBD.texto.trim() !== pSnap.texto.trim()) {
          console.log(`  [CONFLICT] Texto de pregunta difiere para ${pSnap.claveEstable}`);
          totalErrores++;
        }

        if (pBD.orden !== pSnap.orden) {
          console.log(`  [CONFLICT] Orden de pregunta difiere para ${pSnap.claveEstable}: BD=${pBD.orden}, Esperado=${pSnap.orden}`);
          totalErrores++;
        }

        if (pBD.requiereHallazgo !== pSnap.requiereHallazgo) {
          console.log(`  [CONFLICT] requiereHallazgo difiere para ${pSnap.claveEstable}: BD=${pBD.requiereHallazgo}, Esperado=${pSnap.requiereHallazgo}`);
          totalErrores++;
        }

        // Regla específica para CULTURA
        if (sSnap.nombre.toUpperCase() === 'CULTURA' && pBD.requiereHallazgo !== false) {
          console.log(`  [CONFLICT] Pregunta de Cultura DEBE tener requiereHallazgo=false: ${pBD.texto}`);
          totalErrores++;
        }
      }
    }
  }

  // 3. Comprobar que los datos operativos no fueron tocados
  console.log(`\n-----------------------------------------------------------------------------`);
  console.log(`Comprobación de aislamiento operativo (Objetivos y Respuestas):`);
  const resumenOperativo = await prisma.$queryRawUnsafe<any[]>(`
    SELECT vf.numeroVersion, f.slug, COUNT(oa.id) as totalObjetivos, COUNT(ra.id) as totalRespuestas
    FROM versiones_formulario vf
    JOIN formularios f ON vf.formularioId = f.id
    LEFT JOIN objetivos_auditoria oa ON oa.versionFormularioId = vf.id
    LEFT JOIN secciones_formulario sf ON sf.versionFormularioId = vf.id
    LEFT JOIN preguntas_formulario pf ON pf.seccionFormularioId = sf.id
    LEFT JOIN respuestas_auditoria ra ON ra.preguntaFormularioId = pf.id
    WHERE f.slug IN ('evaluacion-5s-administrativa', 'evaluacion-5s-operativa')
    GROUP BY vf.id, vf.numeroVersion, f.slug
    ORDER BY f.slug ASC, vf.numeroVersion ASC;
  `);
  console.table(resumenOperativo);

  console.log(`\n=============================================================================`);
  if (totalErrores === 0) {
    console.log(`RESULTADO: VALIDACIÓN 100% EXITOSA (MATCH). Todas las versiones coinciden.`);
  } else {
    console.log(`RESULTADO: FALLÓ LA VALIDACIÓN con ${totalErrores} errores/conflictos.`);
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
