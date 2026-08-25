import { prisma, cerrarPrisma } from '../src/db';
import { AlcanceFormulario, RolUsuario } from '../src/generated/prisma/enums';

const FORMULARIO_ADMINISTRATIVO = {
  nombre: "EVALUACION 5'S ADMINISTRATIVA",
  slug: 'evaluacion-5s-administrativa',
  descripcion: 'Sistema de Gestión de Calidad · Formato F-16-SA',
  alcance: AlcanceFormulario.ADMINISTRATIVO,
  activo: true,
  version: {
    numeroVersion: 1,
    activa: true,
  },
  secciones: [
    {
      claveEstable: '63b0d326-9cff-578e-b2b7-e29fb3e739d6',
      nombre: "1´S (SEIRI)",
      objetivo: '"Clasificación - Separación": Identificar lo necesario de lo innecesario',
      orden: 10,
      preguntas: [
        {
          claveEstable: '1b1f1188-850f-511e-8723-84c3addc0481',
          texto: 'Se evalúa: Archivo\nDocumentos que se tiene en escritorio, clasificados de acuerdo al uso de cada documento).',
          orden: 10,
        },
        {
          claveEstable: '15bf22a9-1da1-5010-be5b-25aefe7810ab',
          texto: 'Se evalúa: Escritorio\nDocumentos, materiales, equipos innecesarios almacenados o guardados en cajones o gavetas.',
          orden: 20,
        },
        {
          claveEstable: '214ff673-9e8c-520c-9904-a995b7199c4e',
          texto: 'Se evalúa: Control Visual\nArtículos y documentos que no son necesarios para la realización de actividades y que son identificados a simple vista.',
          orden: 30,
        },
        {
          claveEstable: '81f6f17b-939a-5e16-90e5-b3a791a4e313',
          texto: 'Se evalúa: Elemento para descartar\nDocumentos, materiales y equipos que deben ser devueltos o dados de baja por no prestar ninguna utilidad.',
          orden: 40,
        },
      ],
    },
    {
      claveEstable: '425480dc-9ac9-5f75-97bb-f33599d5605f',
      nombre: "2´S (SEITON)",
      objetivo: '"Orden": Designar un lugar para cada cosa',
      orden: 20,
      preguntas: [
        {
          claveEstable: 'ea66f727-5a0c-5fda-bc7c-03b121f23523',
          texto: 'Se evalúa: Identificación de carpetas\nTodas las carpetas están identificadas o rotuladas a fin de localizar documentos con la mayor facilidad posible.',
          orden: 10,
        },
        {
          claveEstable: '127d1318-d2da-5dc3-88d7-e716bdfbaf81',
          texto: 'Se evalúa: Gavetas de escritorio\nExiste mezcla de documentos, elementos y/o artículos que son utilizados, pero no van acorde a la identificación de la gaveta.',
          orden: 20,
        },
        {
          claveEstable: '8d1014cd-7f26-53d5-b8a8-0168de365fe0',
          texto: 'Se evalúa: Organización de equipos y documentos en escritorio\nTodos los documentos, elementos y equipos tienen un lugar fijo y siempre están en el mismo lugar.',
          orden: 30,
        },
        {
          claveEstable: 'eac9ec97-b77f-58d5-8e53-b046b63e15cb',
          texto: 'Se evalúa: Documentos escritorio\nNo tener o contar con documentos en exceso y sin orden sobre el escritorio de trabajo.',
          orden: 40,
        },
      ],
    },
    {
      claveEstable: '0a37e142-b495-51c2-860a-450fd9820091',
      nombre: "3´S (SEISO)",
      objetivo: '"Limpieza": Integrar hábitos de limpieza como un ámbito laboral',
      orden: 30,
      preguntas: [
        {
          claveEstable: '2ea3dce9-84f7-529f-8cb0-3add0f85d3e0',
          texto: 'Se evalúa: Piso\nEl piso de trabajo se encuentra limpio y libre de obstáculos que puedan generar una caída al mismo nivel.',
          orden: 10,
        },
        {
          claveEstable: 'c8c05543-80a7-5002-83e3-06d25f786635',
          texto: 'Se evalúa: Escritorio\nEl escritorio o mesa de trabajo se encuentra limpio y libre de suciedad.',
          orden: 20,
        },
        {
          claveEstable: 'f49352c9-cb9b-53ea-8fca-f4b85886a903',
          texto: 'Se evalúa: Limpieza habitual\nDiariamente se realiza limpieza al área de trabajo y equipos de oficina. (Pantallas, CPU, teclado, teléfonos, gavetas, etc.)',
          orden: 30,
        },
      ],
    },
    {
      claveEstable: '36a014fe-589a-536a-9690-df77bc9f4848',
      nombre: "4´S (SEIKETSU)",
      objetivo: '"Estandarizar": Mantener las condiciones de anteriores S´',
      orden: 40,
      preguntas: [
        {
          claveEstable: 'd1c43b33-04c1-58b0-b917-f60d783b605c',
          texto: 'Se evalúa: Etiquetado y/o rotulado\nTodas las carpetas están identificadas con el etiquetado y/o rotulado estandarizado por parte de la empresa.)',
          orden: 10,
        },
      ],
    },
    {
      claveEstable: 'de4484ad-9480-5374-ad2c-390fd2d9aa00',
      nombre: "5´S (SHITSUKE)",
      objetivo: '"Disciplina": Fomentar la autodisciplina a los colaboradores',
      orden: 50,
      preguntas: [
        {
          claveEstable: 'db5acd61-4fe3-5472-ad71-0180ac987890',
          texto: 'Se evalúa: Cultura\n¿Todos los trabajadores participan en mantener en orden y limpia sus áreas de trabajo?',
          orden: 10,
        },
        {
          claveEstable: '45a3e506-14d6-5b7c-8b47-7e21ab8a740b',
          texto: 'Se evalúa: Cultura\n¿Todos los trabajadores utilizan su uniforme, así como el material de equipo de protección personal para las actividades diarias de su trabajo?',
          orden: 20,
        },
      ],
    },
    {
      claveEstable: '1c7736fc-95d2-5589-a526-519e72646865',
      nombre: "6´S (SECURITY - APPEARANCE)",
      objetivo: '"Seguridad": Fomentar un ambiente de trabajo seguro para los colaboradores',
      orden: 60,
      preguntas: [
        {
          claveEstable: '495b4c49-9afe-55f9-8444-3a9bae6d0a55',
          texto: 'Se evalúa: Seguridad\nEstado de iluminación',
          orden: 10,
        },
        {
          claveEstable: '000d2c36-2a3f-5d4d-bf54-e41a49267fd3',
          texto: 'Se evalúa: Seguridad\n¿Cuenta con equipo contra incendios? (Sin obstruir, Delimitado, y en buenas condiciones sin golpes o falta de pintura).',
          orden: 20,
        },
        {
          claveEstable: '4fdf21a9-7ff6-5ab6-9957-696391fb7e25',
          texto: 'Se evalúa: Seguridad\n¿Todos los trabajadores utilizan su uniforme, así como el material de equipo de protección personal para las actividades diarias de su trabajo?',
          orden: 30,
        },
        {
          claveEstable: 'b5528679-4e9b-5007-8b3a-fe4751bd2a91',
          texto: 'Se evalúa: Imagen\n¿Las condiciones del mobiliario y maquinaria es buena? (pintura, condiciones)',
          orden: 40,
        },
        {
          claveEstable: '719c948b-2bd3-5a1d-be43-a9927e7d8e2d',
          texto: 'Se evalúa: Imagen\nEstado de las instalaciones (pintura, condiciones)',
          orden: 50,
        },
        {
          claveEstable: '1b2ebea4-81f2-5047-b090-36556f552d87',
          texto: 'Se evalúa: Imagen\nInstalaciones electrónicas (seguras y no visibles)',
          orden: 60,
        },
      ],
    },
    {
      claveEstable: 'bdb37162-0a6c-5db3-9a90-da574f4bfabf',
      nombre: 'CULTURA',
      objetivo: 'Realizar las preguntas al personal aplicable en el apartado de cultura, con la finalidad de fomentar la cultura de conocimiento realizando preguntas sobre la metodología.',
      orden: 70,
      preguntas: [
        {
          claveEstable: '213f66d4-3818-5166-8416-bcad9c1afa14',
          texto: "Se evalúa: Cultura\n¿Cuántas y cuáles son las 5'S?",
          orden: 10,
        },
        {
          claveEstable: '49756481-fad5-5189-b14f-d49a76c3ff7c',
          texto: 'Se evalúa: Cultura\n¿Qué significa WPO y para qué nos sirve dentro de nuestro lugar de trabajo?',
          orden: 20,
        },
        {
          claveEstable: '41b96e50-d8c3-5d05-bce2-6782aa348108',
          texto: 'Se evalúa: Cultura\n¿Sabes cuál es el estándar ideal de WPO en tu lugar de trabajo?',
          orden: 30,
        },
      ],
    },
  ],
} as const;

type FormularioAdministrativo = typeof FORMULARIO_ADMINISTRATIVO;
type VersionAdministrativa = NonNullable<Awaited<ReturnType<typeof obtenerVersionExistente>>>;

const assert = (condicion: unknown, mensaje: string): asserts condicion => {
  if (!condicion) throw new Error(mensaje);
};

const aplanarPreguntasEsperadas = (data: FormularioAdministrativo) =>
  data.secciones.flatMap((seccion) => seccion.preguntas);

const obtenerCreadorId = async () => {
  const superAdmin = await prisma.usuario.findFirst({
    where: { activo: true, rol: RolUsuario.SUPER_ADMIN },
    orderBy: { id: 'asc' },
    select: { id: true, nombreUsuario: true, rol: true },
  });

  if (superAdmin) return superAdmin;

  const administrador = await prisma.usuario.findFirst({
    where: { activo: true, rol: RolUsuario.ADMINISTRADOR },
    orderBy: { id: 'asc' },
    select: { id: true, nombreUsuario: true, rol: true },
  });

  if (!administrador) {
    throw new Error('No existe SUPER_ADMIN ni ADMINISTRADOR activo. No se crea usuario automaticamente.');
  }

  return administrador;
};

const obtenerVersionExistente = () =>
  prisma.versionFormulario.findFirst({
    where: {
      numeroVersion: FORMULARIO_ADMINISTRATIVO.version.numeroVersion,
      formulario: { slug: FORMULARIO_ADMINISTRATIVO.slug },
    },
    include: {
      formulario: true,
      secciones: {
        orderBy: { orden: 'asc' },
        include: {
          preguntas: { orderBy: { orden: 'asc' } },
        },
      },
    },
  });

const describirEstructura = (version: VersionAdministrativa) => ({
  formularioId: version.formulario.id,
  versionId: version.id,
  slug: version.formulario.slug,
  alcance: version.formulario.alcance,
  activo: version.formulario.activo,
  numeroVersion: version.numeroVersion,
  versionActiva: version.activa,
  secciones: version.secciones.map((seccion) => ({
    id: seccion.id,
    nombre: seccion.nombre,
    orden: seccion.orden,
    preguntas: seccion.preguntas.map((pregunta) => ({
      id: pregunta.id,
      orden: pregunta.orden,
      texto: pregunta.texto,
    })),
  })),
});

const validarEstructura = (version: VersionAdministrativa) => {
  const diferencias: string[] = [];
  const esperado = FORMULARIO_ADMINISTRATIVO;

  if (version.formulario.nombre !== esperado.nombre) {
    diferencias.push(`Formulario.nombre actual="${version.formulario.nombre}" esperado="${esperado.nombre}"`);
  }

  if (version.formulario.alcance !== esperado.alcance) {
    diferencias.push(`Formulario.alcance actual="${version.formulario.alcance}" esperado="${esperado.alcance}"`);
  }

  if (version.formulario.activo !== esperado.activo) {
    diferencias.push(`Formulario.activo actual=${version.formulario.activo} esperado=${esperado.activo}`);
  }

  if (version.activa !== esperado.version.activa) {
    diferencias.push(`VersionFormulario.activa actual=${version.activa} esperado=${esperado.version.activa}`);
  }

  if (version.secciones.length !== esperado.secciones.length) {
    diferencias.push(`Secciones actuales=${version.secciones.length} esperadas=${esperado.secciones.length}`);
  }

  for (const [indiceSeccion, seccionEsperada] of esperado.secciones.entries()) {
    const seccionActual = version.secciones[indiceSeccion];
    const numeroSeccion = indiceSeccion + 1;

    if (!seccionActual) continue;

    if (seccionActual.claveEstable !== seccionEsperada.claveEstable) {
      diferencias.push(`Seccion ${numeroSeccion}.claveEstable actual="${seccionActual.claveEstable}" esperada="${seccionEsperada.claveEstable}"`);
    }

    if (seccionActual.nombre !== seccionEsperada.nombre) {
      diferencias.push(`Seccion ${numeroSeccion}.nombre actual="${seccionActual.nombre}" esperada="${seccionEsperada.nombre}"`);
    }

    if (seccionActual.objetivo !== seccionEsperada.objetivo) {
      diferencias.push(`Seccion ${numeroSeccion}.objetivo actual="${seccionActual.objetivo ?? ''}" esperado="${seccionEsperada.objetivo}"`);
    }

    if (seccionActual.imagenPublicId !== null || seccionActual.imagenAlt !== null) {
      diferencias.push(`Seccion ${numeroSeccion}.imagen actual debe ser null/null`);
    }

    if (seccionActual.orden !== seccionEsperada.orden) {
      diferencias.push(`Seccion ${numeroSeccion}.orden actual=${seccionActual.orden} esperado=${seccionEsperada.orden}`);
    }

    if (seccionActual.preguntas.length !== seccionEsperada.preguntas.length) {
      diferencias.push(`Seccion ${numeroSeccion}.preguntas actuales=${seccionActual.preguntas.length} esperadas=${seccionEsperada.preguntas.length}`);
    }

    for (const [indicePregunta, preguntaEsperada] of seccionEsperada.preguntas.entries()) {
      const preguntaActual = seccionActual.preguntas[indicePregunta];
      const posicion = esperado.secciones
        .slice(0, indiceSeccion)
        .reduce((total, seccion) => total + seccion.preguntas.length, 0) + indicePregunta + 1;

      if (!preguntaActual) continue;

      if (preguntaActual.claveEstable !== preguntaEsperada.claveEstable) {
        diferencias.push(`Pregunta ${posicion}.claveEstable actual="${preguntaActual.claveEstable}" esperada="${preguntaEsperada.claveEstable}"`);
      }

      if (preguntaActual.texto !== preguntaEsperada.texto) {
        diferencias.push(`Pregunta ${posicion}.texto actual="${preguntaActual.texto}" esperado="${preguntaEsperada.texto}"`);
      }

      if (preguntaActual.orden !== preguntaEsperada.orden) {
        diferencias.push(`Pregunta ${posicion}.orden actual=${preguntaActual.orden} esperado=${preguntaEsperada.orden}`);
      }
    }
  }

  const preguntasActuales = version.secciones.flatMap((seccion) => seccion.preguntas);
  const preguntasEsperadas = aplanarPreguntasEsperadas(esperado);

  if (preguntasActuales.length !== preguntasEsperadas.length) {
    diferencias.push(`Preguntas totales actuales=${preguntasActuales.length} esperadas=${preguntasEsperadas.length}`);
  }

  return diferencias;
};

const crearFormularioAdministrativo = async () => {
  const creador = await obtenerCreadorId();

  return prisma.$transaction(async (tx) => {
    const existente = await tx.formulario.findUnique({
      where: { slug: FORMULARIO_ADMINISTRATIVO.slug },
      select: { id: true },
    });

    if (existente) {
      throw new Error(`El formulario ${FORMULARIO_ADMINISTRATIVO.slug} apareció durante la transacción. Reejecuta el script.`);
    }

    const formulario = await tx.formulario.create({
      data: {
        nombre: FORMULARIO_ADMINISTRATIVO.nombre,
        slug: FORMULARIO_ADMINISTRATIVO.slug,
        descripcion: FORMULARIO_ADMINISTRATIVO.descripcion,
        alcance: FORMULARIO_ADMINISTRATIVO.alcance,
        activo: FORMULARIO_ADMINISTRATIVO.activo,
        creadoPorId: creador.id,
        versiones: {
          create: {
            numeroVersion: FORMULARIO_ADMINISTRATIVO.version.numeroVersion,
            activa: FORMULARIO_ADMINISTRATIVO.version.activa,
            creadoPorId: creador.id,
            secciones: {
              create: FORMULARIO_ADMINISTRATIVO.secciones.map((seccion) => ({
                claveEstable: seccion.claveEstable,
                nombre: seccion.nombre,
                objetivo: seccion.objetivo,
                imagenPublicId: null,
                imagenAlt: null,
                orden: seccion.orden,
                preguntas: {
                  create: seccion.preguntas.map((pregunta) => ({
                    claveEstable: pregunta.claveEstable,
                    texto: pregunta.texto,
                    orden: pregunta.orden,
                  })),
                },
              })),
            },
          },
        },
      },
      include: {
        versiones: {
          where: { numeroVersion: FORMULARIO_ADMINISTRATIVO.version.numeroVersion },
          include: {
            secciones: {
              orderBy: { orden: 'asc' },
              include: { preguntas: { orderBy: { orden: 'asc' } } },
            },
          },
        },
      },
    });

    const version = formulario.versiones[0];
    assert(version, 'No se pudo crear V1 administrativa.');

    return {
      formularioId: formulario.id,
      versionId: version.id,
      creadoPor: creador,
    };
  });
};

const imprimirResumen = (version: VersionAdministrativa, accion: 'CREATED' | 'SKIPPED') => {
  const preguntas = version.secciones.flatMap((seccion) => seccion.preguntas);

  console.log('');
  console.log(`Formulario administrativo ${accion === 'CREATED' ? 'creado' : 'ya existe y es consistente'}.`);
  console.log(`Formulario ID: ${version.formulario.id}`);
  console.log(`Version V1 ID: ${version.id}`);
  console.log(`Slug: ${version.formulario.slug}`);
  console.log(`Alcance: ${version.formulario.alcance}`);
  console.log(`V1 activa: ${version.activa}`);
  console.log(`Secciones: ${version.secciones.length}`);
  console.log(`Preguntas: ${preguntas.length}`);
  console.log('');
  console.log('Distribución:');

  let inicio = 1;
  for (const seccion of version.secciones) {
    const fin = inicio + seccion.preguntas.length - 1;
    console.log(`- ${seccion.nombre}: preguntas ${inicio}-${fin}`);
    inicio = fin + 1;
  }

  console.log('');
  console.log('Preguntas en orden histórico:');
  preguntas.forEach((pregunta, indice) => {
    console.log(`${indice + 1}. ${pregunta.texto}`);
  });
};

const main = async () => {
  const existente = await obtenerVersionExistente();

  if (existente) {
    const diferencias = validarEstructura(existente);

    if (diferencias.length > 0) {
      console.error('El formulario administrativo existe, pero su estructura NO coincide:');
      diferencias.forEach((diferencia) => console.error(`- ${diferencia}`));
      console.error('');
      console.error('Estructura actual:');
      console.error(JSON.stringify(describirEstructura(existente), null, 2));
      throw new Error('No se reparó ni destruyó nada. Revisa las diferencias anteriores.');
    }

    imprimirResumen(existente, 'SKIPPED');
    return;
  }

  const formularioExistente = await prisma.formulario.findUnique({
    where: { slug: FORMULARIO_ADMINISTRATIVO.slug },
    select: { id: true, versiones: { select: { id: true, numeroVersion: true } } },
  });

  if (formularioExistente) {
    throw new Error(
      `Existe ${FORMULARIO_ADMINISTRATIVO.slug} pero no tiene V1. Versiones encontradas: ${
        formularioExistente.versiones.map((version) => `V${version.numeroVersion}#${version.id}`).join(', ') || 'ninguna'
      }`,
    );
  }

  const creado = await crearFormularioAdministrativo();
  const versionCreada = await obtenerVersionExistente();

  assert(versionCreada, 'No se encontró la V1 administrativa después de crearla.');

  const diferencias = validarEstructura(versionCreada);
  assert(diferencias.length === 0, `La estructura creada no coincide:\n${diferencias.join('\n')}`);

  console.log(`Creador: ${creado.creadoPor.nombreUsuario} (${creado.creadoPor.rol})`);
  imprimirResumen(versionCreada, 'CREATED');
};

main()
  .catch((error) => {
    console.error('');
    console.error('POBLADO CANCELADO');
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await cerrarPrisma();
  });
