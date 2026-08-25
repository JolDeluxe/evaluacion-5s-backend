import { prisma } from '../src/db';

const APPLY = process.argv.includes('--apply');
const confirmacion = process.argv.find((arg) =>
  arg.startsWith('--confirm='),
)?.split('=')[1];

const CONFIRMACION_REQUERIDA = 'BORRAR_AUDITORIAS';

const obtenerConteos = async () => ({
  ciclosAuditoria: await prisma.cicloAuditoria.count(),
  formulariosCiclo: await prisma.formularioCiclo.count(),
  objetivosAuditoria: await prisma.objetivoAuditoria.count(),
  asignacionesAuditoria: await prisma.asignacionAuditoria.count(),
  enlacesInvitado: await prisma.enlaceInvitado.count(),
  enviosAuditoria: await prisma.envioAuditoria.count(),
  respuestasAuditoria: await prisma.respuestaAuditoria.count(),
  fotosAuditoria: await prisma.fotoAuditoria.count(),
  notificaciones: await prisma.notificacion.count(),
  entregasNotificacion: await prisma.entregaNotificacion.count(),
  registrosAuditoria: await prisma.registroAuditoria.count(),

  // Estos se conservan.
  usuarios: await prisma.usuario.count(),
  areas: await prisma.area.count(),
  formularios: await prisma.formulario.count(),
  versionesFormulario: await prisma.versionFormulario.count(),
  seccionesFormulario: await prisma.seccionFormulario.count(),
  preguntasFormulario: await prisma.preguntaFormulario.count(),
});

const imprimir = (
  titulo: string,
  conteos: Awaited<ReturnType<typeof obtenerConteos>>,
) => {
  console.log('');
  console.log('====================================================');
  console.log(` ${titulo}`);
  console.log('====================================================');

  console.table(conteos);
};

const main = async () => {
  const antes = await obtenerConteos();
  imprimir('DATOS ACTUALES', antes);

  console.log('');
  console.log('SE BORRARÁ:');
  console.log('- ciclos de auditoría');
  console.log('- formularios asociados a ciclos');
  console.log('- objetivos');
  console.log('- asignaciones');
  console.log('- enlaces de invitado');
  console.log('- envíos');
  console.log('- respuestas');
  console.log('- fotos');
  console.log('- notificaciones y entregas');
  console.log('- registros de auditoría');
  console.log('');
  console.log('SE CONSERVARÁ:');
  console.log('- usuarios y sesiones');
  console.log('- áreas y usuarios_areas');
  console.log('- formularios');
  console.log('- versiones de formulario');
  console.log('- secciones');
  console.log('- preguntas');
  console.log('- suscripciones push');

  if (!APPLY) {
    console.log('');
    console.log('✅ DRY RUN. No se modificó la BD.');
    console.log('');
    console.log(
      `Para ejecutar: bun scripts/limpiar-datos-auditorias.ts --apply --confirm=${CONFIRMACION_REQUERIDA}`,
    );
    return;
  }

  if (confirmacion !== CONFIRMACION_REQUERIDA) {
    throw new Error(
      `Confirmación incorrecta. Debes usar --confirm=${CONFIRMACION_REQUERIDA}`,
    );
  }

  await prisma.$transaction(
    async (tx) => {
      /*
       * ObjetivoAuditoria <-> EnvioAuditoria tiene una referencia circular:
       * Objetivo.envioResultadoId apunta al envío oficial y cada envío
       * apunta a su objetivo. Primero soltamos el puntero oficial.
       */
      await tx.objetivoAuditoria.updateMany({
        data: {
          envioResultadoId: null,
        },
      });

      /*
       * Dependientes de usuario pero relacionados con la ejecución histórica.
       * Se limpian para no conservar notificaciones/logs apuntando a auditorías
       * que dejarán de existir.
       */
      await tx.entregaNotificacion.deleteMany();
      await tx.notificacion.deleteMany();
      await tx.registroAuditoria.deleteMany();

      /*
       * Orden requerido por las FK Restrict del schema actual.
       */
      await tx.fotoAuditoria.deleteMany();
      await tx.respuestaAuditoria.deleteMany();
      await tx.envioAuditoria.deleteMany();
      await tx.enlaceInvitado.deleteMany();
      await tx.asignacionAuditoria.deleteMany();
      await tx.objetivoAuditoria.deleteMany();
      await tx.formularioCiclo.deleteMany();
      await tx.cicloAuditoria.deleteMany();
    },
    {
      maxWait: 10_000,
      timeout: 60_000,
    },
  );

  const despues = await obtenerConteos();
  imprimir('DESPUÉS DE LIMPIAR', despues);

  const tablasAuditoriaConDatos = [
    despues.ciclosAuditoria,
    despues.formulariosCiclo,
    despues.objetivosAuditoria,
    despues.asignacionesAuditoria,
    despues.enlacesInvitado,
    despues.enviosAuditoria,
    despues.respuestasAuditoria,
    despues.fotosAuditoria,
  ].some((cantidad) => cantidad !== 0);

  if (tablasAuditoriaConDatos) {
    throw new Error(
      'La limpieza terminó, pero todavía existen registros de auditoría.',
    );
  }

  console.log('');
  console.log('✅ Limpieza terminada.');
  console.log('✅ Formularios y áreas se conservaron.');
  console.log('✅ Usuarios y autenticación se conservaron.');
  console.log('');
  console.log(
    'NOTA: este script NO elimina archivos físicos ya existentes en Cloudinary.',
  );
};

main()
  .catch((error) => {
    console.error('');
    console.error('❌ LIMPIEZA CANCELADA');
    console.error(
      error instanceof Error ? error.message : String(error),
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
