import { createHash } from 'node:crypto';
import { RolUsuario } from '../src/generated/prisma/enums';
import { prisma, cerrarPrisma } from '../src/db';
import { normalizarNombreUsuario } from '../src/utils/crypto';
import { registrarAuditoria } from '../src/modules/registros_auditoria/helper';
import { formularios5S } from './formularios-5s.data';

const obtenerArg = (nombre: string) => {
  const indice = Bun.argv.indexOf(nombre);
  if (indice === -1) return null;
  return Bun.argv[indice + 1] ?? null;
};

const uuidEstable = (semilla: string) => {
  const hex = createHash('sha1').update(`encuestas-5s:${semilla}`).digest('hex').slice(0, 32).split('');
  hex[12] = '5';
  const variante = Number.parseInt(hex[16] ?? '0', 16);
  hex[16] = ((variante & 0x3) | 0x8).toString(16);
  const valor = hex.join('');
  return `${valor.slice(0, 8)}-${valor.slice(8, 12)}-${valor.slice(12, 16)}-${valor.slice(16, 20)}-${valor.slice(20)}`;
};

const assert = (condicion: unknown, mensaje: string): asserts condicion => {
  if (!condicion) throw new Error(mensaje);
};

const obtenerUsuarioCreadorId = async () => {
  const usuarioSolicitado = obtenerArg('--usuario') ?? process.env.SEED_FORMULARIOS_USUARIO;
  const usuario = usuarioSolicitado
    ? await prisma.usuario.findUnique({
        where: { nombreUsuario: normalizarNombreUsuario(usuarioSolicitado) },
        select: { id: true },
      })
    : await prisma.usuario.findFirst({
        where: { activo: true, rol: { in: [RolUsuario.SUPER_ADMIN, RolUsuario.ADMINISTRADOR] } },
        orderBy: { id: 'asc' },
        select: { id: true },
      });
  if (!usuario) throw new Error('No existe un usuario administrador activo para registrar la creacion de formularios');
  return usuario.id;
};

const poblar = async () => {
  const creadoPorId = await obtenerUsuarioCreadorId();
  const resultados: Array<{ slug: string; accion: 'CREATED' | 'SKIPPED'; versionId?: number }> = [];

  for (const data of formularios5S) {
    const resultado = await prisma.$transaction(async (tx) => {
      const formulario = await tx.formulario.upsert({
        where: { slug: data.slug },
        update: {
          nombre: data.nombre,
          descripcion: data.descripcion,
          alcance: data.alcance,
          activo: true,
        },
        create: {
          nombre: data.nombre,
          slug: data.slug,
          descripcion: data.descripcion,
          alcance: data.alcance,
          creadoPorId,
        },
        include: { versiones: { orderBy: { numeroVersion: 'desc' }, take: 1 } },
      });

      if (formulario.versiones.length) {
        return { accion: 'SKIPPED' as const, versionId: formulario.versiones[0]?.id };
      }

      const version = await tx.versionFormulario.create({
        data: {
          formularioId: formulario.id,
          numeroVersion: 1,
          activa: true,
          creadoPorId,
          secciones: {
            create: data.secciones.map((seccion, seccionIndex) => ({
              claveEstable: uuidEstable(`${data.slug}:seccion:${seccion.titulo}`),
              nombre: seccion.titulo,
              objetivo: seccion.objetivo,
              imagenPublicId: seccion.imagen?.publicIdCloudinary ?? null,
              imagenAlt: seccion.imagen?.alt ?? null,
              orden: (seccionIndex + 1) * 10,
              preguntas: {
                create: seccion.preguntas.map((pregunta, preguntaIndex) => ({
                  claveEstable: uuidEstable(`${data.slug}:seccion:${seccion.titulo}:pregunta:${preguntaIndex + 1}`),
                  texto: pregunta,
                  orden: (preguntaIndex + 1) * 10,
                })),
              },
            })),
          },
        },
      });

      await registrarAuditoria({
        usuarioId: creadoPorId,
        accion: 'POBLAR_FORMULARIO_5S',
        tipoEntidad: 'VersionFormulario',
        idEntidad: version.id,
        datosNuevos: { formularioId: formulario.id, slug: data.slug, versionId: version.id },
      }, tx);

      return { accion: 'CREATED' as const, versionId: version.id };
    });

    if (resultado.accion === 'CREATED' && resultado.versionId) {
      const [secciones, preguntas] = await Promise.all([
        prisma.seccionFormulario.count({ where: { versionFormularioId: resultado.versionId } }),
        prisma.preguntaFormulario.count({ where: { seccionFormulario: { versionFormularioId: resultado.versionId } } }),
      ]);
      assert(secciones === data.secciones.length, `${data.slug}: secciones esperadas ${data.secciones.length}, recibidas ${secciones}`);
      assert(preguntas === data.criteriosEsperados, `${data.slug}: preguntas esperadas ${data.criteriosEsperados}, recibidas ${preguntas}`);
    }

    resultados.push({ slug: data.slug, ...resultado });
  }

  console.table(resultados);
};

poblar()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await cerrarPrisma();
  });
