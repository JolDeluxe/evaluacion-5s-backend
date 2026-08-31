# API Backend Encuestas / Auditorias 5S

Base URL local: `http://localhost:3000`

Base API: `/api/v1`

## Convenciones

- Respuesta exitosa general: `{ "datos": ... }`.
- Listados paginados: `{ "datos": [...], "meta": { "pagina", "limite", "total" } }`.
- Errores: `{ "error": { "codigo", "mensaje", "detalles?" } }`.
- Sesion: cookie HttpOnly firmada `SESION_NOMBRE_COOKIE`.
- Metodos mutables (`POST`, `PUT`, `PATCH`, `DELETE`) validan `Origin`.
- Roles con cuenta: `SUPER_ADMIN`, `ADMINISTRADOR`, `AUDITOR`.
- `SUPER_ADMIN` administra, pero no realiza auditorias.

## Publicos

- `GET /api/health`
- `GET /api/ready`
- `POST /api/v1/auth/iniciar-sesion`
- `POST /api/v1/auth/solicitar-restablecimiento`
- `POST /api/v1/auth/restablecer-contrasena`
- `GET /api/v1/invitados/:token`
- `POST /api/v1/invitados/:token/auditorias`
- `POST /api/v1/invitados/:token/evidencias/firmar`

Los invitados usan enlace temporal delegado desde una asignacion. No existe rol
`INVITADO`.

## Autenticados

### Sesion

- `GET /api/v1/auth/me`
- `POST /api/v1/auth/cerrar-sesion`
- `POST /api/v1/auth/cerrar-todas-las-sesiones`
- `POST /api/v1/auth/cambiar-contrasena`

### Areas

- `GET /api/v1/areas?tipo=ADMINISTRATIVA&activo=true`
- `POST /api/v1/areas`
- `PATCH /api/v1/areas/:id`
- `POST /api/v1/areas/:id/desactivar`
- `POST /api/v1/areas/:id/reactivar`
- `PUT /api/v1/areas/:id/usuarios`
- `GET /api/v1/areas/:id/codigo-verificacion`
- `GET /api/v1/areas/:id/codigo-verificacion/qr`
- `POST /api/v1/areas/:id/codigo-verificacion/rotar`

### Formularios

- `GET /api/v1/formularios`
- `POST /api/v1/formularios`
- `GET /api/v1/formularios/:id`
- `PATCH /api/v1/formularios/:id`
- `GET /api/v1/formularios/:id/versiones`
- `GET /api/v1/formularios/versiones/:versionId`
- `POST /api/v1/formularios/:id/versiones`
- `POST /api/v1/formularios/versiones/:versionId/imagenes/firmar`

Las versiones usan `SeccionFormulario` y `PreguntaFormulario`. Al crear una nueva
version se desactiva la version anterior; una version usada por ciclos queda
como fotografia historica.

### Ciclos y Asignaciones

- `GET /api/v1/asignaciones`
- `GET /api/v1/asignaciones/:id/auditoria`
- `POST /api/v1/asignaciones`
- `POST /api/v1/asignaciones/:id/publicar`
- `POST /api/v1/asignaciones/:id/reasignar`
- `POST /api/v1/asignaciones/:id/enlaces-invitado`

### Auditorias

- `GET /api/v1/auditorias`
- `POST /api/v1/auditorias`
- `GET /api/v1/auditorias/:id`
- `POST /api/v1/auditorias/:id/invalidar`
- `POST /api/v1/auditorias/objetivos/:objetivoId/oficial/:envioId`

Body resumido de envio:

```json
{
  "identificadorCliente": "uuid",
  "asignacionAuditoriaId": 1,
  "nombreAuditorSnapshot": "Nombre auditor",
  "finalizadoEn": "2026-08-21T12:00:00.000Z",
  "codigoVerificacion": "ABCD-2345",
  "respuestas": [
    {
      "preguntaFormularioId": 1,
      "cumple": true,
      "hallazgo": null,
      "fotos": []
    }
  ]
}
```

El score se calcula con preguntas booleanas: cada `cumple=true` suma 1. Si
`cumple=false`, `hallazgo` es obligatorio. Las fotos se guardan como
`FotoAuditoria` ligada a `RespuestaAuditoria`.

### Evidencias

- `POST /api/v1/evidencias/firmar`: firma carga directa Cloudinary.
- `GET /api/v1/evidencias/envios/:envioId`: lista fotos autorizadas.

### Resultados

- `GET /api/v1/resultados/resumen?anio=2026&mes=8`
- `GET /api/v1/resultados/ciclos/:id`
- `GET /api/v1/resultados/areas?tipoArea=OPERATIVA`
- `GET /api/v1/resultados/areas/:id/historial`

Los resultados usan `ObjetivoAuditoria.envioResultadoId` como fuente de verdad.

### Sistema tecnico

Solo `SUPER_ADMIN`.

- `GET /api/v1/sistema/resumen`
- `GET /api/v1/sistema/sesiones`
- `POST /api/v1/sistema/sesiones/:id/revocar`
- `GET /api/v1/sistema/entregas-notificacion`
- `POST /api/v1/sistema/entregas-notificacion/:id/reintentar`
