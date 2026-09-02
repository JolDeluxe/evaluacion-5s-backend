import { cerrarPrisma, prisma } from '../src/db';
import { EstadoAsignacionAuditoria } from '../src/generated/prisma/enums';

const desdeArg = process.argv.find((arg) => arg.startsWith('--desde='))?.slice('--desde='.length);
const aplicar = process.argv.includes('--apply');
const confirmacion = process.argv.find((arg) => arg.startsWith('--confirm='))?.slice('--confirm='.length);

if (!desdeArg || !/^\d{4}-(0[1-9]|1[0-2])$/.test(desdeArg)) {
  throw new Error('Uso: bun scripts/limpiar-asignaciones-desde-periodo.ts --desde=AAAA-MM [--apply --confirm=ELIMINAR-ASIGNACIONES-DE-PRUEBA]');
}

const [anio, mes] = desdeArg.split('-').map(Number);
const desdeWhere = {
  OR: [
    { anio: { gt: anio } },
    { anio, mes: { gte: mes } },
  ],
};

const main = async () => {
  const objetivos = await prisma.objetivoAuditoria.findMany({
    where: desdeWhere,
    select: {
      id: true,
      anio: true,
      mes: true,
      periodo: true,
      area: { select: { id: true, codigo: true, nombre: true } },
      envioResultadoId: true,
      asignacionesAuditoria: {
        select: { id: true, estado: true, iniciadoEn: true, completadoEn: true },
      },
      enviosAuditoria: {
        select: {
          id: true,
          invalidadoEn: true,
          respuestasAuditoria: {
            select: { id: true, fotosAuditoria: { select: { id: true, publicIdCloudinary: true } } },
          },
        },
      },
    },
    orderBy: [{ anio: 'asc' }, { mes: 'asc' }, { area: { nombre: 'asc' } }, { periodo: 'asc' }],
  });

  const objetivoIds = objetivos.map((objetivo) => objetivo.id);
  const asignacionIds = objetivos.flatMap((objetivo) => objetivo.asignacionesAuditoria.map((item) => item.id));
  const envioIds = objetivos.flatMap((objetivo) => objetivo.enviosAuditoria.map((item) => item.id));
  const respuestaIds = objetivos.flatMap((objetivo) => objetivo.enviosAuditoria.flatMap((envio) => envio.respuestasAuditoria.map((item) => item.id)));
  const fotos = objetivos.flatMap((objetivo) => objetivo.enviosAuditoria.flatMap((envio) => envio.respuestasAuditoria.flatMap((respuesta) => respuesta.fotosAuditoria)));

  const [mensuales, enlaces, registros] = await Promise.all([
    prisma.asignacionMensual.findMany({
      where: desdeWhere,
      select: { id: true, areaId: true, anio: true, mes: true, auditorId: true },
      orderBy: [{ anio: 'asc' }, { mes: 'asc' }, { areaId: 'asc' }],
    }),
    asignacionIds.length
      ? prisma.enlaceInvitado.findMany({
          where: { asignacionAuditoriaId: { in: asignacionIds } },
          select: { id: true, asignacionAuditoriaId: true, usadoEn: true, revocadoEn: true },
        })
      : [],
    objetivoIds.length || asignacionIds.length
      ? prisma.registroAuditoria.findMany({
          where: {
            OR: [
              ...(objetivoIds.length ? [{ tipoEntidad: 'ObjetivoAuditoria', idEntidad: { in: objetivoIds } }] : []),
              ...(asignacionIds.length ? [{ tipoEntidad: 'AsignacionAuditoria', idEntidad: { in: asignacionIds } }] : []),
            ],
          },
          select: { id: true, tipoEntidad: true, idEntidad: true, accion: true },
        })
      : [],
  ]);

  const completadas = objetivos.flatMap((objetivo) => objetivo.asignacionesAuditoria)
    .filter((asignacion) => asignacion.estado === EstadoAsignacionAuditoria.COMPLETADA || asignacion.completadoEn);
  const iniciadas = objetivos.flatMap((objetivo) => objetivo.asignacionesAuditoria)
    .filter((asignacion) => asignacion.estado === EstadoAsignacionAuditoria.EN_PROCESO || asignacion.iniciadoEn);
  const envios = objetivos.flatMap((objetivo) => objetivo.enviosAuditoria);
  const respuestas = objetivos.flatMap((objetivo) => objetivo.enviosAuditoria.flatMap((envio) => envio.respuestasAuditoria));
  const resultadosCanonicos = objetivos.filter((objetivo) => objetivo.envioResultadoId !== null);
  const enlacesUsados = enlaces.filter((enlace) => enlace.usadoEn !== null);

  const porMes = new Map<string, { objetivos: number; asignaciones: number; mensuales: number }>();
  for (const objetivo of objetivos) {
    const clave = `${objetivo.anio}-${String(objetivo.mes).padStart(2, '0')}`;
    const actual = porMes.get(clave) ?? { objetivos: 0, asignaciones: 0, mensuales: 0 };
    actual.objetivos += 1;
    actual.asignaciones += objetivo.asignacionesAuditoria.length;
    porMes.set(clave, actual);
  }
  for (const mensual of mensuales) {
    const clave = `${mensual.anio}-${String(mensual.mes).padStart(2, '0')}`;
    const actual = porMes.get(clave) ?? { objetivos: 0, asignaciones: 0, mensuales: 0 };
    actual.mensuales += 1;
    porMes.set(clave, actual);
  }

  const reporte = {
    modo: aplicar ? 'APPLY SOLICITADO' : 'DRY RUN',
    desde: desdeArg,
    totales: {
      objetivosAuditoria: objetivoIds.length,
      asignacionesMensuales: mensuales.length,
      asignacionesAuditoria: asignacionIds.length,
      enlacesInvitado: enlaces.length,
      enviosAuditoria: envioIds.length,
      respuestasAuditoria: respuestaIds.length,
      fotosAuditoria: fotos.length,
      registrosAuditoriaRelacionados: registros.length,
    },
    porMes: Object.fromEntries(porMes),
    protecciones: {
      asignacionesCompletadas: completadas.length,
      asignacionesIniciadas: iniciadas.length,
      resultadosCanonicos: resultadosCanonicos.length,
      enviosAuditoria: envios.length,
      respuestasAuditoria: respuestas.length,
      evidencias: fotos.length,
      enlacesUsados: enlacesUsados.length,
    },
    ids: {
      objetivosAuditoria: objetivoIds,
      asignacionesMensuales: mensuales.map((item) => item.id),
      asignacionesAuditoria: asignacionIds,
      enlacesInvitado: enlaces.map((item) => item.id),
      enviosAuditoria: envioIds,
      respuestasAuditoria: respuestaIds,
      fotosAuditoria: fotos.map((item) => item.id),
      registrosAuditoria: registros.map((item) => item.id),
    },
  };

  console.log(JSON.stringify(reporte, null, 2));

  const contieneTrabajoReal = completadas.length > 0
    || iniciadas.length > 0
    || resultadosCanonicos.length > 0
    || envios.length > 0
    || respuestas.length > 0
    || fotos.length > 0
    || enlacesUsados.length > 0;

  if (!aplicar) {
    console.log('\nDRY RUN: no se modificó ningún registro.');
    if (contieneTrabajoReal) console.log('BLOQUEADO PARA APPLY: se detectó trabajo que puede ser real.');
    return;
  }
  if (contieneTrabajoReal) {
    throw new Error('Limpieza bloqueada: existen auditorías iniciadas/completadas, resultados, respuestas, evidencias o invitaciones usadas.');
  }
  if (confirmacion !== 'ELIMINAR-ASIGNACIONES-DE-PRUEBA') {
    throw new Error('Falta --confirm=ELIMINAR-ASIGNACIONES-DE-PRUEBA. No se modificó ningún registro.');
  }

  await prisma.$transaction(async (tx) => {
    if (enlaces.length) await tx.enlaceInvitado.deleteMany({ where: { id: { in: enlaces.map((item) => item.id) } } });
    if (asignacionIds.length) await tx.asignacionAuditoria.deleteMany({ where: { id: { in: asignacionIds } } });
    if (mensuales.length) await tx.asignacionMensual.deleteMany({ where: { id: { in: mensuales.map((item) => item.id) } } });
    if (objetivoIds.length) await tx.objetivoAuditoria.deleteMany({ where: { id: { in: objetivoIds } } });
    if (registros.length) await tx.registroAuditoria.deleteMany({ where: { id: { in: registros.map((item) => item.id) } } });
  });
  console.log('APPLY completado.');
};

try {
  await main();
} finally {
  await cerrarPrisma();
}
