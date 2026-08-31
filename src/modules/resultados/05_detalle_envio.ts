import type { Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../../db';
import { env } from '../../config/env';
import { construirPeriodoCompat } from '../../utils/periodos';
import { responder } from '../../utils/respuesta';
import { assertPuedeVerEnvioResultado } from './servicio';

const esquemaId = z.object({ id: z.coerce.number().int().positive() });

export const obtenerDetalleEnvio = async (req: Request, res: Response) => {
  const { id } = esquemaId.parse(req.params);
  await assertPuedeVerEnvioResultado(prisma, req.autenticacion, id);

  const envio = await prisma.envioAuditoria.findUniqueOrThrow({
    where: { id },
    include: {
      objetivoAuditoria: {
        include: {
          area: true,
          versionFormulario: {
            include: {
              formulario: true,
            },
          },
        },
      },
      respuestasAuditoria: {
        include: {
          preguntaFormulario: {
            include: {
              seccionFormulario: true,
            },
          },
          fotosAuditoria: true,
        },
      },
    },
  });

  const area = {
    id: envio.objetivoAuditoria.area.id,
    codigo: envio.objetivoAuditoria.area.codigo,
    nombre: envio.objetivoAuditoria.area.nombre,
    tipo: envio.objetivoAuditoria.area.tipo,
  };

  const ciclo = construirPeriodoCompat(envio.objetivoAuditoria);

  const formulario = {
    id: envio.objetivoAuditoria.versionFormulario.formulario.id,
    nombre: envio.objetivoAuditoria.versionFormulario.formulario.nombre,
    version: envio.objetivoAuditoria.versionFormulario.numeroVersion,
  };

  // Resolver la versión más reciente activa del formulario para texto canónico de preguntas por claveEstable
  const versionUltimaActiva = await prisma.versionFormulario.findFirst({
    where: {
      formularioId: envio.objetivoAuditoria.versionFormulario.formularioId,
      activa: true,
    },
    include: {
      secciones: {
        include: { preguntas: true },
      },
    },
  });

  const mapTextoPreguntaCanonico = new Map<string, string>();
  const mapNombreSeccionCanonico = new Map<string, string>();
  if (versionUltimaActiva) {
    for (const sec of versionUltimaActiva.secciones) {
      if (sec.claveEstable) mapNombreSeccionCanonico.set(sec.claveEstable, sec.nombre);
      for (const preg of sec.preguntas) {
        if (preg.claveEstable) mapTextoPreguntaCanonico.set(preg.claveEstable, preg.texto);
      }
    }
  }

  const respuestas = envio.respuestasAuditoria.map((resp) => {
    const p = resp.preguntaFormulario;
    const s = p.seccionFormulario;
    const textoCanonico = p.claveEstable ? mapTextoPreguntaCanonico.get(p.claveEstable) ?? p.texto : p.texto;
    const nombreSeccionCanonico = s.claveEstable ? mapNombreSeccionCanonico.get(s.claveEstable) ?? s.nombre : s.nombre;

    return {
      id: resp.id,
      cumple: resp.cumple,
      hallazgo: resp.hallazgo,
      pregunta: {
        id: p.id,
        claveEstable: p.claveEstable,
        texto: textoCanonico,
        orden: p.orden,
      },
      seccion: {
        id: s.id,
        claveEstable: s.claveEstable,
        nombre: nombreSeccionCanonico,
        orden: s.orden,
      },
      fotos: resp.fotosAuditoria.map((foto) => ({
        id: foto.id,
        publicIdCloudinary: foto.publicIdCloudinary,
        url: `https://res.cloudinary.com/${env.CLOUDINARY_CLOUD_NAME ?? ''}/image/upload/${foto.publicIdCloudinary}`,
        ancho: foto.ancho,
        alto: foto.alto,
        formato: foto.formato,
      })),
    };
  });

  // Sort by seccion.orden ASC, then by pregunta.orden ASC
  respuestas.sort((a, b) => {
    if (a.seccion.orden !== b.seccion.orden) {
      return a.seccion.orden - b.seccion.orden;
    }
    return a.pregunta.orden - b.pregunta.orden;
  });

  responder(res, {
    envio: {
      id: envio.id,
      identificadorCliente: envio.identificadorCliente,
      nombreAuditorSnapshot: envio.nombreAuditorSnapshot,
      origen: envio.origen,
      puntajeObtenido: Number(envio.puntajeObtenido),
      puntajePosible: Number(envio.puntajePosible),
      porcentaje: Number(envio.porcentaje),
      finalizadoEn: envio.finalizadoEn,
      verificadoEn: envio.verificadoEn,
      recibidoEn: envio.recibidoEn,
      invalidadoEn: envio.invalidadoEn,
    },
    area,
    ciclo,
    formulario,
    respuestas,
  });
};
