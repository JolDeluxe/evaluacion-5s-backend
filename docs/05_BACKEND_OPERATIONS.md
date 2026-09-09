# Operacion Backend

## Variables

Minimas:

```env
NODE_ENV=development
PORT=3000
DATABASE_URL=mysql://usuario:password@localhost:3306/encuestas_5s
FRONTEND_ORIGIN=http://localhost:5173
COOKIE_SECRET=una_cadena_larga_de_al_menos_32_caracteres
```

Sesion:

```env
SESION_NOMBRE_COOKIE=sid_5s
SESION_DIAS_INACTIVIDAD=180
SESION_RENOVAR_CADA_HORAS=8
PROXY_CONFIANZA=false
```

Servicios externos y Notificaciones por Correo:

```env
# Almacenamiento multimedia
CLOUDINARY_ENABLED=false
CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=

# Notificaciones Push Web (VAPID)
VAPID_ENABLED=false
VAPID_SUBJECT=
VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=

# Proveedor SMTP (Pool y Rate Limiting)
SMTP_ENABLED=false
SMTP_HOST=
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=
SMTP_PASS=
SMTP_FROM=
SMTP_POOL_ENABLED=true
SMTP_MAX_CONNECTIONS=1
SMTP_RATE_LIMIT=1
SMTP_RATE_DELTA_MS=3000

# Interruptor general y modo de prueba de correo
EMAIL_ENABLED=false
EMAIL_TEST_ENABLED=false
EMAIL_PROVIDER=smtp
APP_PUBLIC_URL=http://localhost:5173

# Microsoft Graph (Alternativa MSAL)
MICROSOFT_GRAPH_CLIENT_ID=
MICROSOFT_GRAPH_AUTHORITY=https://login.microsoftonline.com/consumers
MICROSOFT_GRAPH_SENDER_EMAIL=
EMAIL_TOKEN_ENCRYPTION_KEY=

# Canales adicionales
WHATSAPP_ENABLED=false

# Worker en segundo plano
NOTIFICACIONES_WORKER_ENABLED=true
NOTIFICACIONES_WORKER_CRON=*/1 * * * *
```

Cuando un servicio se habilita, el backend exige sus credenciales al arrancar.
No guardar secretos reales en documentación ni repositorio.

## Codigo de Verificacion por Area

Cada area tiene `codigoVerificacion`, un codigo corto unico que se puede mostrar
como texto o QR imprimible. No usa GPS, HMAC, versionado QR ni secretos
compartidos con frontend.

Operaciones administrativas:

```bash
GET  /api/v1/areas/:id/codigo-verificacion
GET  /api/v1/areas/:id/codigo-verificacion/qr
POST /api/v1/areas/:id/codigo-verificacion/rotar
```

El envio de auditoria debe incluir `codigoVerificacion`. Si no coincide con el
area del objetivo, el backend rechaza la captura.

## Base de Datos

```bash
bunx --bun prisma format
bunx --bun prisma validate
bunx --bun prisma generate
bunx --bun prisma migrate deploy
```

En desarrollo, para crear una nueva migracion:

```bash
bunx --bun prisma migrate dev --name nombre_migracion
```

## Primer Administrador

No hay seed automatico. Crear el primer admin deliberadamente:

```bash
bun run admin:crear
```

Variables opcionales:

```bash
ADMIN_NOMBRE_USUARIO=admin ADMIN_NOMBRE="Administrador" ADMIN_CORREO=admin@empresa.com bun run admin:crear
```

## Formularios 5S

Para poblar las evaluaciones maestras iniciales:

```bash
bun run datos:formularios-5s
```

El script crea `Formulario`, `VersionFormulario`, `SeccionFormulario` y
`PreguntaFormulario`; no crea bloques, opciones ni reglas.

## Arranque

Desarrollo:

```bash
bun run dev
```

Produccion/PM2:

```bash
pm2 start ecosystem.config.cjs
pm2 restart encuestas-5s-backend
pm2 reload encuestas-5s-backend
pm2 save
pm2 resurrect
```

## Health y Ready

```bash
curl http://localhost:3000/api/health
curl http://localhost:3000/api/ready
```

## Workers y Despacho de Correo

El worker de notificaciones se ejecuta en segundo plano como parte del proceso Express:

```env
NOTIFICACIONES_WORKER_ENABLED=true
NOTIFICACIONES_WORKER_CRON=*/1 * * * *
```

Crons programados en `jobs.ts`:
- `*/1 * * * *`: Worker de entregas (`procesarEntregasPendientes()`). Toma hasta 25 entregas por ciclo, adquiere un lock de 2 minutos (`bloqueadoHasta`) y despacha por canal.
- `*/5 * * * *`: Marcado de asignaciones vencidas (`actualizarAsignacionesVencidas()`).
- `*/30 * * * *`: Reconciliadores automáticos (asignaciones del mes, recordatorios P1/P2 y resultados post-gracia).

Doble interruptor de seguridad:
1. `EMAIL_ENABLED` (.env): Si está en `false`, las entregas por canal `CORREO` no son reclamadas ni fallan; se quedan en `PENDIENTE`.
2. Control Operativo en BD (`SecretoSistema` clave `control_operativo_correos`): Puede ser `ACTIVO` o `PAUSADO` (fail-safe: si no existe el registro o falla la BD, asume `PAUSADO`).
3. Ambos interruptores deben estar en activo para que salgan correos regulares. Las pruebas canario en cola (`probarCola`) requieren `EMAIL_TEST_ENABLED=true` y Control Operativo `ACTIVO`.

## Cloudinary

Habilitar solo si el frontend subira evidencias:

```env
CLOUDINARY_ENABLED=true
CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=
```

El backend firma la carga; no recibe archivos por Multer.

## Validacion Antes de Entregar

```bash
bunx --bun prisma format
bunx --bun prisma validate
bunx --bun prisma generate
bun run typecheck
bun run lint
bun run start
```

Despues probar `GET /api/health`, `GET /api/ready`, login y `GET /api/v1/auth/me`.
