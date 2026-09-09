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
version se desactiva la version anterior; una version usada por objetivos queda
como fotografia historica.

### Asignaciones

- `GET /api/v1/asignaciones/mensual`
- `GET /api/v1/asignaciones/mensual/carga`
- `POST /api/v1/asignaciones/mensual/autoasignar`
- `PUT /api/v1/asignaciones/mensual/:areaId`
- `GET /api/v1/asignaciones`
- `GET /api/v1/asignaciones/:id/auditoria`
- `POST /api/v1/asignaciones/:id/enlaces-invitado`
- `DELETE /api/v1/asignaciones/:id/enlaces-invitado/activo`
- `POST /api/v1/asignaciones/:id/reabrir`

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
- `GET /api/v1/resultados/areas?tipoArea=OPERATIVA`
- `GET /api/v1/resultados/areas/:id/historial`
- `GET /api/v1/resultados/areas/:areaId`
- `GET /api/v1/resultados/areas/:areaId/periodos/:periodo`
- `GET /api/v1/resultados/envios/:id`
- `GET /api/v1/resultados/general` (requiere roles con acceso a resultados completos)
- `GET /api/v1/resultados/general/pdf` (requiere roles admin negocio, descarga reporte PDF)
- `GET /api/v1/resultados/reportes/general/pdf-directo?token=...` (descarga directa pública de PDF firmada con HMAC token para correos)

Los resultados usan `ObjetivoAuditoria.envioResultadoId` como fuente de verdad.

### Sistema técnico y Notificaciones de Correo

Exclusivo para rol `SUPER_ADMIN`.

- `GET /api/v1/sistema/resumen`: Estadísticas globales de usuarios, sesiones y registros de auditoría.
- `GET /api/v1/sistema/sesiones`: Listado de sesiones activas.
- `POST /api/v1/sistema/sesiones/:id/revocar`: Revocación manual de sesión.
- `GET /api/v1/sistema/entregas-notificacion`: Listado paginado con soporte de cursor y filtros (`canal`, `estado`, `desde`, `hasta`, `limite`, `cursor`).
- `POST /api/v1/sistema/entregas-notificacion/:id/reintentar`: Reintento de entrega fallida (resetea intentos a 0 y pasa a PENDIENTE).
- `GET /api/v1/sistema/correos/resumen`: Métricas consolidadas (totales por estado, actividad 24h/7d/30d y por tipo).
- `GET /api/v1/sistema/correos/estado`: Configuración actual de correo, proveedores (SMTP / Graph), timezone y worker.
- `POST /api/v1/sistema/correos/reenviar/:id`: Reenvío manual de entrega enviada (crea nueva entrega hacia el correo actual del usuario).
- `GET /api/v1/sistema/correos/simular`: Simulación dry-run de asignaciones, recordatorios P1/P2 y resultados.
- `GET /api/v1/sistema/correos/preview`: Renderizado HTML/texto con QR inline y logo en Data URI para previsualización modal.
- `POST /api/v1/sistema/correos/enviar-prueba`: Envío de prueba controlado dirigido exclusivamente a la cuenta del SUPER_ADMIN.
- `GET /api/v1/sistema/correos/control-operativo`: Lectura del estado persistido en BD (ACTIVO/PAUSADO) y métricas preflight de la cola.
- `POST /api/v1/sistema/correos/control-operativo/pausar`: Pausa operativa manual fail-safe.
- `POST /api/v1/sistema/correos/control-operativo/reanudar`: Reanudación operativa (bloquea si existen correos dirigidos a `@example.test`).
- `GET /api/v1/sistema/correos/entregas/:id/detalle`: Detalle completo de una entrega con datos de usuario y notificación.
- `POST /api/v1/sistema/correos/entregas/:id/cancelar`: Cancelación individual de una entrega PENDIENTE o FALLIDA.
- `POST /api/v1/sistema/correos/entregas/cancelar-masivo`: Cancelación en lote de hasta 500 entregas PENDIENTE o FALLIDA.
- `POST /api/v1/sistema/correos/probar-cola`: Encolamiento de exactamente 1 entrega canario en estado PENDIENTE dirigida al SUPER_ADMIN.
- `GET /api/v1/sistema/correos/microsoft/estado`: Estado de autenticación y conexión MSAL con Microsoft Graph.
- `POST /api/v1/sistema/correos/microsoft/iniciar`: Inicio de flujo Device Code de autenticación con Microsoft.
- `POST /api/v1/sistema/correos/microsoft/desconectar`: Desconexión y limpieza de tokens de Microsoft Graph.
