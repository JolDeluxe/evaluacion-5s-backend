import type { Response } from 'express';

export const responder = <T>(res: Response, datos: T, estado = 200) => {
  res.status(estado).json({ datos });
};

export const responderLista = <T>(
  res: Response,
  datos: T[],
  meta: {
    pagina?: number;
    limite: number;
    total: number;
    totalPaginas?: number;
    hayMas?: boolean;
    hasMore?: boolean;
    siguienteCursor?: number | string | null;
    nextCursor?: string | number | null;
  }
) => {
  const totalPaginas = meta.totalPaginas ?? Math.max(1, Math.ceil(meta.total / (meta.limite || 1)));
  const pagina = meta.pagina ?? 1;
  const hayMas = meta.hayMas ?? (meta.hasMore ?? false);
  const siguienteCursor = meta.siguienteCursor ?? (meta.nextCursor ?? null);
  const nextCursor = siguienteCursor !== null && siguienteCursor !== undefined ? String(siguienteCursor) : null;

  res.json({
    datos,
    items: datos,
    meta: {
      ...meta,
      pagina,
      totalPaginas,
      hayMas,
      hasMore: hayMas,
      siguienteCursor,
      nextCursor,
    },
    paginacion: {
      pagina,
      limite: meta.limite,
      total: meta.total,
      totalPaginas,
      page: pagina,
      limit: meta.limite,
      totalPages: totalPaginas,
      hayMas,
      hasMore: hayMas,
      siguienteCursor,
      nextCursor,
    },
  });
};

export const responderCreado = <T>(res: Response, datos: T) => responder(res, datos, 201);

export const responderSinContenido = (res: Response) => {
  res.status(204).send();
};
