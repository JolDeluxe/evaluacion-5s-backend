import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { autenticarOpcional } from '../../middlewares/autenticacion';
import { resolverCodigoQr } from './01_resolver';

export const qrRouter = Router();

const limiteQr = rateLimit({ windowMs: 15 * 60 * 1000, limit: 60, standardHeaders: true, legacyHeaders: false });

qrRouter.get('/:codigo', limiteQr, autenticarOpcional, resolverCodigoQr);
