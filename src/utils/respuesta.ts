import type { Response } from 'express';

export const responder = <T>(res: Response, datos: T, estado = 200) => {
  res.status(estado).json({ datos });
};

export const responderLista = <T>(
  res: Response,
  datos: T[],
  meta: { pagina: number; limite: number; total: number }
) => {
  res.json({ datos, meta });
};

export const responderCreado = <T>(res: Response, datos: T) => responder(res, datos, 201);

export const responderSinContenido = (res: Response) => {
  res.status(204).send();
};
