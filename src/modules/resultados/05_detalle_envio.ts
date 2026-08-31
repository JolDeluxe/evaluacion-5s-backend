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

  const respuestas = envio.respuestasAuditoria.map((resp) => {
    const p = resp.preguntaFormulario;
    const s = p.seccionFormulario;
    return {
      id: resp.id,
      cumple: resp.cumple,
      hallazgo: resp.hallazgo,
      pregunta: {
        id: p.id,
        texto: p.texto,
        orden: p.orden,
      },
      seccion: {
        id: s.id,
        nombre: s.nombre,
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
