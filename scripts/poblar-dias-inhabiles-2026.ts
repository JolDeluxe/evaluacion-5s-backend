import { prisma } from '../src/db';
import { TipoDiaInhabil } from '../src/generated/prisma/enums';

const DIAS_INHABILES_2026 = [
  {
    fecha: new Date('2026-01-01T00:00:00.000Z'),
    descripcion: 'Año Nuevo',
    tipo: TipoDiaInhabil.DESCANSO_OFICIAL,
  },
  {
    fecha: new Date('2026-02-02T00:00:00.000Z'),
    descripcion: 'Primer lunes de febrero en conmemoración del 5 de febrero (Constitución)',
    tipo: TipoDiaInhabil.DESCANSO_OFICIAL,
  },
  {
    fecha: new Date('2026-03-16T00:00:00.000Z'),
    descripcion: 'Tercer lunes de marzo en conmemoración del 21 de marzo (Natalicio de Benito Juárez)',
    tipo: TipoDiaInhabil.DESCANSO_OFICIAL,
  },
  {
    fecha: new Date('2026-05-01T00:00:00.000Z'),
    descripcion: 'Día del Trabajo',
    tipo: TipoDiaInhabil.DESCANSO_OFICIAL,
  },
  {
    fecha: new Date('2026-09-16T00:00:00.000Z'),
    descripcion: 'Día de la Independencia',
    tipo: TipoDiaInhabil.DESCANSO_OFICIAL,
  },
  {
    fecha: new Date('2026-11-16T00:00:00.000Z'),
    descripcion: 'Tercer lunes de noviembre en conmemoración del 20 de noviembre (Revolución Mexicana)',
    tipo: TipoDiaInhabil.DESCANSO_OFICIAL,
  },
  {
    fecha: new Date('2026-12-25T00:00:00.000Z'),
    descripcion: 'Navidad',
    tipo: TipoDiaInhabil.DESCANSO_OFICIAL,
  },
];

async function main() {
  console.log('Poblando días inhábiles oficiales México 2026 (LFT Art. 74)...');
  let creados = 0;

  for (const dia of DIAS_INHABILES_2026) {
    await prisma.diaInhabil.upsert({
      where: { fecha: dia.fecha },
      update: {
        descripcion: dia.descripcion,
        tipo: dia.tipo,
      },
      create: {
        fecha: dia.fecha,
        descripcion: dia.descripcion,
        tipo: dia.tipo,
      },
    });
    creados++;
  }

  console.log(`✓ ${creados} días inhábiles procesados con éxito.`);
}

main()
  .catch((e) => {
    console.error('Error al poblar días inhábiles:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
