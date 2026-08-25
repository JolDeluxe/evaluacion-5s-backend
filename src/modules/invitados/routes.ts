import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { obtenerInvitacion } from './01_obtener';
import { enviarAuditoriaInvitado } from './02_enviar';
import { listarAreasPublicasInvitado } from './03_areas_publicas';
import { iniciarInvitadoPublico } from './04_iniciar_publico';
import { firmarEvidenciaInvitadoPublico } from './05_firmar_publico';
import { firmarEvidenciaInvitado } from './06_firmar_evidencia';
import { enviarAuditoriaInvitadoPublico } from './07_enviar_publico';

export const invitadosRouter = Router();

const limiteInvitado = rateLimit({ windowMs: 15 * 60 * 1000, limit: 60, standardHeaders: true, legacyHeaders: false });

invitadosRouter.get('/areas-publicas', limiteInvitado, listarAreasPublicasInvitado);
invitadosRouter.post('/iniciar', limiteInvitado, iniciarInvitadoPublico);
invitadosRouter.post('/publico/evidencias/firmar', limiteInvitado, firmarEvidenciaInvitadoPublico);
invitadosRouter.post('/publico/auditorias', limiteInvitado, enviarAuditoriaInvitadoPublico);
invitadosRouter.get('/:token', limiteInvitado, obtenerInvitacion);
invitadosRouter.post('/:token/evidencias/firmar', limiteInvitado, firmarEvidenciaInvitado);
invitadosRouter.post('/:token/auditorias', limiteInvitado, enviarAuditoriaInvitado);
