import type { AlcanceFormulario } from '../src/generated/prisma/enums';

export type SeccionFormulario5S = {
  titulo: string;
  objetivo: string;
  imagen?: {
    publicIdCloudinary: string;
    alt: string;
  };
  preguntas: string[];
};

export type Formulario5SData = {
  nombre: string;
  slug: string;
  descripcion: string;
  alcance: AlcanceFormulario;
  criteriosEsperados: number;
  secciones: SeccionFormulario5S[];
};

export const formularios5S: Formulario5SData[] = [
  {
    nombre: "EVALUACION 5'S OPERATIVA",
    slug: 'evaluacion-5s-operativa',
    descripcion: 'Sistema de Gestión de Calidad · Formato F-16-SA',
    alcance: 'OPERATIVO',
    criteriosEsperados: 34,
    secciones: [
      {
        titulo: "1´S (SEIRI)",
        objetivo: '"Clasificación - Separación": Identificar lo necesario de lo innecesario',
        preguntas: [
          '¿En el área solo se encuentran herramientas o materiales correspondientes a la actividad y/o departamento?',
          '¿En el área de trabajo no se encuentran objetos personales?',
          '¿Existen elementos inutilizados dentro del área separados e identificados (maquinaria, mp, cajones, herramientas, etc)?',
          '¿No se tiene un exceso de material?',
        ],
      },
      {
        titulo: "2´S (SEITON)",
        objetivo: '"Orden": Designar un lugar para cada cosa',
        preguntas: [
          '¿Están claramente definidos los pasillos, áreas de almacenamiento y lugares de trabajo, sin objetos fuera de su lugar y/o que se encuentren obstruyendo?',
          '¿Se encuentran delimitadas las áreas de herramientas de trabajo, maquinaria, residuos o basura y producto terminado o en proceso?',
          '¿Existen objetos fuera de sus áreas delimitadas? (Herramientas de trabajo, maquinaria, residuos o basura, producto).',
          '¿Se manejan los residuos correctamente?',
          'Vías de circulación transitables, claras y sin obstrucción.',
          'Hay exceso de herramienta o maquinaria en las áreas.',
          '¿Las áreas de almacenamiento son empleadas con el propósito asignado?',
          '¿No existen materiales fuera de las estanterías o espacios de almacenamiento?',
          '¿Hay información fuera de lugares asignados?',
          '¿Los materiales asignados se cuentan únicamente en los espacios correspondientes?',
        ],
      },
      {
        titulo: "3´S (SEISO)",
        objetivo: '"Limpieza": Integrar hábitos de limpieza como un ámbito laboral',
        preguntas: [
          '¿Las áreas de almacenamiento de materiales se encuentran limpias (Estanterías)?',
          '¿Los espacios de trabajo se encuentran limpios (Maquinaria, equipo de cómputo, mesas de trabajo, ventiladores, lámparas, pisos)?',
          '¿Los espacios de trabajo, maquinaria, mesas, cajones de trabajo están libres de alimentos?',
          'Pizarrones (limpios)',
          'Instalaciones (pisos, paredes, ventanas, techos) ¿Se encuentran limpias y libres de materiales innecesarios?',
        ],
      },
      {
        titulo: "4´S (SEIKETSU)",
        objetivo: '"Estandarizar": Mantener las condiciones de anteriores S´',
        preguntas: [
          '¿El encargado de área aporta y trabaja con el equipo para mantener el trabajo de las ´s anteriores?',
          'Pizarrones (mismo formato en toda la planta)',
          '¿Se cuenta con layout del área actualizado y con la correcta delimitación del espacio de trabajo para que se lleve a cabo el bueno uso de los espacios?',
        ],
      },
      {
        titulo: "5´S (SHITSUKE)",
        objetivo: '"Disciplina": Fomentar la autodisciplina a los colaboradores',
        preguntas: [
          '¿Todos los trabajadores participan en mantener en orden y limpia sus áreas de trabajo?',
          '¿Todos los trabajadores utilizan su uniforme, así como el material de equipo de protección personal para las actividades diarias de su trabajo?',
        ],
      },
      {
        titulo: "6´S (SECURITY - APPEARANCE)",
        objetivo: '"Seguridad": Fomentar un ambiente de trabajo seguro para los colaboradores',
        preguntas: [
          'Estado de iluminación',
          '¿Cuenta con equipo contra incendios? (Sin obstruir, Delimitado, y en buenas condiciones sin golpes o falta de pintura).',
          '¿Cuenta con la señalética correspondiente y en condiciones?',
          '¿Las condiciones del mobiliario y maquinaria es buena? (pintura, condiciones).',
          'Estado de las instalaciones (pintura, condiciones).',
          'Instalaciones electrónicas (seguras y no visibles).',
          '¿Uso de equipo de protección personal de acuerdo a lo establecido por seguridad e higiene como lo marca la señalética?',
        ],
      },
      {
        titulo: 'CULTURA',
        objetivo: 'Realizar las preguntas al personal aplicable en el apartado de cultura, con la finalidad de fomentar la cultura de conocimiento realizando preguntas sobre la metodología.',
        preguntas: [
          "Se evalúa: Cultura\n¿Cuántas y cuáles son las 5'S?",
          'Se evalúa: Cultura\n¿Qué significa WPO y para qué nos sirve dentro de nuestro lugar de trabajo?',
          'Se evalúa: Cultura\n¿Sabes cuál es el estándar ideal de WPO en tu lugar de trabajo?',
        ],
      },
    ],
  },
  {
    nombre: "EVALUACION 5'S ADMINISTRATIVA",
    slug: 'evaluacion-5s-administrativa',
    descripcion: 'Sistema de Gestión de Calidad · Formato F-16-SA',
    alcance: 'ADMINISTRATIVO',
    criteriosEsperados: 23,
    secciones: [
      {
        titulo: "1´S (SEIRI)",
        objetivo: '"Clasificación - Separación": Identificar lo necesario de lo innecesario',
        preguntas: [
          'Se evalúa: Archivo\nDocumentos que se tiene en escritorio, clasificados de acuerdo al uso de cada documento).',
          'Se evalúa: Escritorio\nDocumentos, materiales, equipos innecesarios almacenados o guardados en cajones o gavetas.',
          'Se evalúa: Control Visual\nArtículos y documentos que no son necesarios para la realización de actividades y que son identificados a simple vista.',
          'Se evalúa: Elemento para descartar\nDocumentos, materiales y equipos que deben ser devueltos o dados de baja por no prestar ninguna utilidad.',
        ],
      },
      {
        titulo: "2´S (SEITON)",
        objetivo: '"Orden": Designar un lugar para cada cosa',
        preguntas: [
          'Se evalúa: Identificación de carpetas\nTodas las carpetas están identificadas o rotuladas a fin de localizar documentos con la mayor facilidad posible.',
          'Se evalúa: Gavetas de escritorio\nExiste mezcla de documentos, elementos y/o artículos que son utilizados, pero no van acorde a la identificación de la gaveta.',
          'Se evalúa: Organización de equipos y documentos en escritorio\nTodos los documentos, elementos y equipos tienen un lugar fijo y siempre están en el mismo lugar.',
          'Se evalúa: Documentos escritorio\nNo tener o contar con documentos en exceso y sin orden sobre el escritorio de trabajo.',
        ],
      },
      {
        titulo: "3´S (SEISO)",
        objetivo: '"Limpieza": Integrar hábitos de limpieza como un ámbito laboral',
        preguntas: [
          'Se evalúa: Piso\nEl piso de trabajo se encuentra limpio y libre de obstáculos que puedan generar una caída al mismo nivel.',
          'Se evalúa: Escritorio\nEl escritorio o mesa de trabajo se encuentra limpio y libre de suciedad.',
          'Se evalúa: Limpieza habitual\nDiariamente se realiza limpieza al área de trabajo y equipos de oficina. (Pantallas, CPU, teclado, teléfonos, gavetas, etc.)',
        ],
      },
      {
        titulo: "4´S (SEIKETSU)",
        objetivo: '"Estandarizar": Mantener las condiciones de anteriores S´',
        preguntas: [
          'Se evalúa: Etiquetado y/o rotulado\nTodas las carpetas están identificadas con el etiquetado y/o rotulado estandarizado por parte de la empresa.)',
        ],
      },
      {
        titulo: "5´S (SHITSUKE)",
        objetivo: '"Disciplina": Fomentar la autodisciplina a los colaboradores',
        preguntas: [
          'Se evalúa: Cultura\n¿Todos los trabajadores participan en mantener en orden y limpia sus áreas de trabajo?',
          'Se evalúa: Cultura\n¿Todos los trabajadores utilizan su uniforme, así como el material de equipo de protección personal para las actividades diarias de su trabajo?',
        ],
      },
      {
        titulo: "6´S (SECURITY - APPEARANCE)",
        objetivo: '"Seguridad": Fomentar un ambiente de trabajo seguro para los colaboradores',
        preguntas: [
          'Se evalúa: Seguridad\nEstado de iluminación',
          'Se evalúa: Seguridad\n¿Cuenta con equipo contra incendios? (Sin obstruir, Delimitado, y en buenas condiciones sin golpes o falta de pintura).',
          'Se evalúa: Seguridad\n¿Todos los trabajadores utilizan su uniforme, así como el material de equipo de protección personal para las actividades diarias de su trabajo?',
          'Se evalúa: Imagen\n¿Las condiciones del mobiliario y maquinaria es buena? (pintura, condiciones)',
          'Se evalúa: Imagen\nEstado de las instalaciones (pintura, condiciones)',
          'Se evalúa: Imagen\nInstalaciones electrónicas (seguras y no visibles)',
        ],
      },
      {
        titulo: 'CULTURA',
        objetivo: 'Realizar las preguntas al personal aplicable en el apartado de cultura, con la finalidad de fomentar la cultura de conocimiento realizando preguntas sobre la metodología.',
        preguntas: [
          "Se evalúa: Cultura\n¿Cuántas y cuáles son las 5'S?",
          'Se evalúa: Cultura\n¿Qué significa WPO y para qué nos sirve dentro de nuestro lugar de trabajo?',
          'Se evalúa: Cultura\n¿Sabes cuál es el estándar ideal de WPO en tu lugar de trabajo?',
        ],
      },
    ],
  },
];
