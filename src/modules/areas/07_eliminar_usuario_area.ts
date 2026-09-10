import type { Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../../db';
import { responderSinContenido } from '../../utils/respuesta';
import { registrarAuditoria } from '../registros_auditoria/helper';
import { esquemaId } from './zod';

const esquemaQueryUsuario = z.object({
  usuarioId: z.coerce.number().int().positive(),
});

export const eliminarUsuarioArea = async (req: Request, res: Response) => {
  const { id: areaId } = esquemaId.parse(req.params);
  const { usuarioId } = esquemaQueryUsuario.parse(req.query);

  const resultado = await prisma.$transaction(async (tx) => {
    const relacion = await tx.usuarioArea.findUnique({
      where: { usuarioId_areaId: { usuarioId, areaId } },
    });
    if (!relacion) return { desvinculado: false, advertencia: null };

    await tx.usuarioArea.delete({
      where: { id: relacion.id },
    });

    // Validar si el usuario tenía seEvalua y ahora queda huérfano sin áreas
    const [usuario, areasRestantes] = await Promise.all([
      tx.usuario.findUnique({ where: { id: usuarioId }, select: { id: true, seEvalua: true, nombre: true } }),
      tx.usuarioArea.count({ where: { usuarioId } }),
    ]);

    let advertencia: string | null = null;
    if (usuario?.seEvalua && areasRestantes === 0) {
      advertencia = `El usuario ${usuario.nombre} tiene activa la evaluación 50/50 (seEvalua) pero se ha quedado sin áreas asignadas.`;
    }

    await registrarAuditoria({
      usuarioId: req.autenticacion?.usuarioId,
      accion: 'ELIMINAR_USUARIO_AREA',
      tipoEntidad: 'UsuarioArea',
      idEntidad: relacion.id,
      datosAnteriores: relacion,
    }, tx);

    return { desvinculado: true, advertencia };
  });

  if (resultado.advertencia) {
    res.setHeader('X-Warning-Message', encodeURIComponent(resultado.advertencia));
  }

  responderSinContenido(res);
};
