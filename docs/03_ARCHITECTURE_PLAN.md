# 03_ARCHITECTURE_PLAN.md

# Plan maestro de arquitectura — Encuestas / Auditorías 5S

> Documento de referencia funcional y técnica para el desarrollo del sistema.
>
> Este archivo debe leerse junto con:
>
> - `AGENTS.md`
> - `docs/01_STRUCTURE.md`
> - `docs/02_TESTING.md`
>
> **Importante:** este documento define dirección, reglas y arquitectura. No implica que todas las carpetas, módulos o tablas deban crearse de inmediato. Se implementarán por fases, evitando infraestructura prematura.

---

## 1. Objetivo del proyecto

Construir desde cero una aplicación web/PWA para realizar auditorías 5S dentro de la organización, reemplazando el proceso actual basado en formularios externos, automatizaciones frágiles, Excel y transformaciones que dependen de posiciones de columnas.

El sistema debe permitir:

- iniciar sesión con usuarios internos;
- mantener sesiones persistentes durante largos periodos;
- permitir auditorías mediante enlace de invitado cuando sea necesario;
- asignar auditorías periódicamente;
- evitar duplicados accidentales sin bloquear casos legítimos;
- crear y versionar formularios;
- modificar preguntas sin alterar resultados históricos;
- soportar auditorías administrativas y operativas;
- trabajar correctamente desde celular;
- funcionar como PWA;
- soportar trabajo offline;
- subir fotografías/evidencias desde cualquier celular;
- comprimir y optimizar imágenes;
- emitir Web Push, correo y WhatsApp;
- mostrar resultados históricos, KPI y cobertura;
- permitir administración desde escritorio;
- mantener el mismo backend si en el futuro se migra de servidor local a Railway.

---

## 2. Tipos principales de usuario

### 2.1 Auditor autenticado

Puede:

- iniciar sesión;
- mantener la sesión activa;
- ver auditorías asignadas;
- realizar auditorías;
- continuar borradores;
- trabajar offline;
- adjuntar evidencias;
- firmar;
- consultar sus auditorías e historial;
- recibir notificaciones.

### 2.2 Invitado

El invitado **no será un usuario de la base de datos**.

Entrará mediante un enlace autorizado generado para una auditoría o asignación específica.

Debe poder:

- introducir su nombre;
- seleccionar o confirmar el área a auditar;
- realizar una auditoría;
- recibir aviso si el área ya fue auditada;
- continuar de todas formas cuando corresponda.

No tendrá acceso al dashboard administrativo ni a información interna fuera del alcance del enlace.

### 2.3 Administrador

Puede administrar:

- usuarios;
- roles;
- áreas;
- formularios;
- versiones;
- preguntas;
- opciones;
- reglas;
- asignaciones;
- ciclos;
- auditorías;
- auditorías duplicadas/adicionales;
- resultados;
- KPI;
- notificaciones;
- configuración.

### 2.4 Visualizador

Rol opcional pero recomendable.

Puede consultar resultados, KPI e históricos, pero no modificar configuración.

---

## 3. Arquitectura general

### Producción inicial

```text
                    INTERNET
                       │
          ┌────────────┴────────────┐
          │                         │
          ▼                         ▼
       NETLIFY                  CLOUDINARY
React + TypeScript             Evidencias
Tailwind + PWA                 Fotos/Firmas
IndexedDB
          │
          │ HTTPS
          ▼
 API con dominio estable
          │
   CLOUDFLARE TUNNEL
          │
          ▼
 SERVIDOR DE EMPRESA
          │
    Bun + Express
          │
        Prisma
          │
          ▼
        MySQL
```

### Producción futura

```text
Netlify
+
Railway Bun/Express
+
Railway MySQL
+
Cloudinary
```

Debe mantenerse **el mismo código**. Solo cambiarán variables de entorno, ubicación de MySQL, infraestructura y DNS/dominio de API.

No debe existir una "versión local" y otra "versión Railway".

---

## 4. Tecnologías base

### Frontend

- React
- TypeScript strict
- React Router
- Tailwind CSS
- PWA
- IndexedDB
- almacenamiento offline
- Web Push
- diseño mobile-first para auditorías
- diseño desktop-first para administración y KPI

### Backend

- Bun
- Express
- TypeScript strict
- Prisma ORM estable
- MySQL
- Zod
- Pino
- Cloudinary
- Web Push
- Nodemailer
- integración REST con WhatsAPI/servicio WhatsApp

### Infraestructura

- Netlify
- Cloudflare Tunnel
- PM2
- MySQL local inicialmente
- Railway como opción futura
- Cloudinary para archivos

---

## 5. Constructor de formularios

No se construirá un clon completo de Tally.

Se construirá un **constructor especializado en auditorías 5S**.

Debe soportar como mínimo:

- título;
- texto informativo;
- texto corto;
- texto largo;
- fecha;
- dropdown;
- selección única;
- selección múltiple;
- evidencia;
- firma;
- separador;
- criterio 5S.

---

## 6. Bloque especial `CRITERIO_5S`

Este será uno de los bloques más importantes.

Un criterio 5S agrupa conceptualmente:

```text
Pregunta
+
Cumplimiento
+
Hallazgo
+
Evidencia
+
Puntuación
```

Ejemplo conceptual:

```text
CRITERIO 5S

Pregunta:
"¿El área se encuentra correctamente identificada?"

Cumple:
○ Sí
○ No

Si responde NO:
☑ solicitar hallazgo
☑ solicitar evidencia

Puntuación:
Sí = 1
No = 0
```

La UI del auditor debe renderizarlo como una sola unidad.

Esto evita que el administrador pueda separar accidentalmente pregunta, hallazgo y evidencia.

---

## 7. Constructor visual

El editor será:

- una sola columna;
- bloques ordenables;
- drag & drop;
- handle tipo `⋮⋮`;
- sin flechas de subir/bajar;
- con preview;
- con publicación;
- con historial/versiones.

Ejemplo:

```text
Evaluación 5S Operativa

⋮⋮ Área
⋮⋮ Supervisor
⋮⋮ Auditor
⋮⋮ Fecha

⋮⋮ 1. Archivo
⋮⋮ 2. Orden del área
⋮⋮ 3. Elementos inutilizados
⋮⋮ 4. ...

⋮⋮ Firma Auditor
⋮⋮ Firma Supervisor

+ Agregar bloque
```

---

## 8. Versionado de formularios

Modelo conceptual:

```text
Form
└── FormVersion
    ├── V1
    ├── V2
    ├── V3
    └── ...
```

Estados:

```text
DRAFT
PUBLISHED
ARCHIVED
```

### Regla crítica

Una versión `PUBLISHED` **nunca se modifica**.

Si el administrador edita un formulario publicado:

```text
V2 PUBLISHED
        ↓ editar
V3 DRAFT
```

Solo cuando publica V3 comienza a utilizarse.

---

## 9. Históricos inmutables

Ejemplo:

Agosto:

```text
20 preguntas
17 correctas
85 %
```

Septiembre:

```text
25 preguntas
```

La auditoría de agosto sigue siendo:

```text
17 / 20
85 %
```

Nunca:

```text
17 / 25
68 %
```

Los resultados históricos jamás se recalculan con el formulario actual.

---

## 10. Identidad estable de preguntas

Las preguntas no deben identificarse por posición.

Cada pregunta/bloque tendrá:

```text
stableKey = UUID
order = número
```

Si cambia de posición, cambia `order`, pero `stableKey` permanece intacto.

Esto elimina completamente dependencias tipo:

```text
columna G
columna H
columna I
```

---

## 11. Modelo conceptual de base de datos

No implementar el schema completo hasta validarlo.

| Grupo | Tabla | Función |
|---|---|---|
| Usuarios | `User` | Personas con cuenta |
| Auth | `Session` | Sesiones persistentes |
| Organización | `Area` | Áreas auditables |
| Formularios | `Form` | Identidad del formulario |
| Formularios | `FormVersion` | Versiones inmutables |
| Formularios | `FormBlock` | Preguntas/bloques |
| Formularios | `FormOption` | Opciones de selección |
| Formularios | `FormRule` | Reglas condicionales |
| Auditorías | `AuditCycle` | Corte de auditoría |
| Auditorías | `AuditAssignment` | Quién audita qué |
| Invitados | `GuestLink` | Enlace delegado |
| Auditorías | `AuditSubmission` | Auditoría realizada |
| Auditorías | `AuditAnswer` | Respuestas |
| Evidencias | `AuditEvidence` | Metadata de Cloudinary |
| Notificaciones | `PushSubscription` | Suscripción por dispositivo |
| Notificaciones | `Notification` | Notificación lógica |
| Notificaciones | `NotificationDelivery` | Envíos por canal |
| Seguridad | `AuditLog` | Trazabilidad administrativa |

---

## 12. Usuario

Conceptualmente:

```text
User

id
name
email / username
passwordHash
role
homeAreaId
isActive
createdAt
updatedAt
```

`homeAreaId` será útil para evitar que un auditor audite su propia área.

No borrar físicamente usuarios históricos. Usar desactivación.

---

## 13. Roles

Roles con cuenta:

```text
SUPER_ADMIN
ADMINISTRADOR
AUDITOR
```

El invitado NO será un rol.

No implementar un RBAC excesivamente complejo en la primera versión.

---

## 14. Invitados mediante enlaces

Modelo:

```text
GuestLink
```

Ejemplo:

```text
https://5s.dominio.com/g/<token>
```

El token debe:

- ser aleatorio y de alta entropía;
- guardarse hasheado;
- poder revocarse;
- tener expiración;
- estar limitado a una auditoría/asignación;
- no permitir acceso general al sistema.

---

## 15. Auditoría duplicada

Si un invitado o auditor selecciona un área ya auditada:

**No bloquear automáticamente.**

Mostrar advertencia:

```text
Esta área ya tiene una auditoría registrada
en este corte.

[ Elegir otra área ]
[ Continuar de todas formas ]
```

Debe existir la posibilidad legítima de realizar una segunda auditoría.

---

## 16. Auditoría oficial vs adicional

Distinguir entre auditoría almacenada y auditoría oficial para KPI.

Ejemplo:

```text
ALMACÉN

Auditoría A
88 %
OFICIAL

Auditoría B
95 %
ADICIONAL
```

Si A fue incorrecta:

```text
A → INVALIDADA
B → OFICIAL
```

No borrar A. Debe conservarse trazabilidad.

---

## 17. Ciclos de auditoría

Habrá dos auditorías/cortes por mes.

Ejemplo conceptual:

```text
AGOSTO 2026

Corte 1
1 al 15

Corte 2
16 al 31
```

Cada corte será un `AuditCycle`.

---

## 18. Asignaciones

Cada auditoría asignada será un `AuditAssignment`.

Ejemplo:

```text
CORTE 1

Juan   → Cintos
Carlos → Avío
María  → Contabilidad
```

El sistema podrá generar asignaciones automáticas más adelante.

---

## 19. Reglas de asignación

### Reglas duras

```text
Auditor ≠ su propia área
Solo auditores activos
Solo áreas activas
Una auditoría oficial por área/corte
Formulario correcto según tipo de área
```

### Reglas de preferencia

```text
Evitar repetir áreas recientes
Balancear carga
Rotar auditores
Evitar patrones repetitivos
```

El sistema debería generar primero un borrador de asignaciones y el administrador confirmarlo antes de publicar.

---

## 20. El ciclo congela la versión del formulario

Si inicia Corte 1 con `Operativa V3` y durante el corte se publica `Operativa V4`, Corte 1 sigue usando V3.

V4 puede comenzar a utilizarse en el siguiente corte.

Esto garantiza igualdad de criterios dentro del mismo periodo.

---

## 21. Formularios administrativos y operativos

No hardcodear lógica específica en React o Express.

Modelo:

```text
Form
```

Ejemplos:

```text
Evaluación 5S Administrativa
Evaluación 5S Operativa
```

Y áreas:

```text
Area.type

ADMINISTRATIVE
OPERATIONAL
```

Esto permitirá crear otros formularios en el futuro sin reprogramar la aplicación.

---

## 22. Puntuación

Cada criterio debe definir puntuación.

Ejemplo:

```text
Sí = 1
No = 0
```

Al responder:

```text
scoreEarned = 1
scorePossible = 1
```

Al finalizar deben guardarse:

```text
scoreEarned
scorePossible
percentage
```

como snapshot histórico.

---

## 23. Backend como autoridad de puntuación

React puede mostrar un resultado provisional.

El resultado oficial lo calcula siempre el backend.

```text
Frontend
↓
envía respuestas
↓
Express
↓
valida FormVersion exacta
↓
calcula scoring
↓
MySQL
```

No confiar en valores calculados exclusivamente por el navegador.

---

## 24. Resultado global independiente del número actual de áreas

Nunca recalcular históricos usando el número actual de áreas.

Ejemplo:

```text
Agosto
20 áreas auditadas
Promedio = 91.6 %
```

Si en noviembre hay 26 áreas, agosto sigue siendo 20 áreas y 91.6 %.

El cálculo histórico usa las auditorías oficiales del ciclo histórico.

---

## 25. KPI de resultado vs cobertura

No mezclar:

```text
Resultado 5S
```

con:

```text
Cobertura de auditorías
```

Ejemplo:

```text
Resultado 5S
91.6 %

Cobertura
18 / 20
90 %
```

Son indicadores distintos.

---

## 26. Auditoría mobile-first

La experiencia de auditor debe diseñarse primero para celular.

No usar tablas comprimidas.

Ejemplo:

```text
7 de 23

7. ¿El área se encuentra correctamente identificada?

[ SÍ ]    [ NO ]

Hallazgo detectado
[.....................]

Evidencia
[ Tomar fotografía ]
```

---

## 27. Offline-first

Cada respuesta debe guardarse primero localmente.

```text
Usuario responde
↓
IndexedDB
↓
guardado local
↓
sincronización cuando haya red
```

La auditoría debe seguir funcionando si se cae WiFi, Cloudflare Tunnel, Express o MySQL temporalmente.

---

## 28. Estados de auditoría local

Ejemplo:

```text
DRAFT
↓
FINALIZED_LOCAL
↓
PENDING_SYNC
↓
SYNCING
↓
SYNCED
```

Errores:

```text
SYNC_ERROR
```

No borrar nunca un borrador por un error de red.

---

## 29. Idempotencia

Cada auditoría creada en el dispositivo tendrá:

```text
clientSubmissionId = UUID
```

En MySQL debe existir restricción única.

Si una conexión mala hace que el frontend reintente varias veces, solo debe existir una auditoría.

---

## 30. Evidencias e imágenes

Arquitectura recomendada:

```text
Foto original
↓
compresión local cuando sea posible
↓
IndexedDB si está offline
↓
signed upload
↓
Cloudinary incoming transformation
↓
asset optimizado
↓
MySQL guarda metadata/referencia
```

---

## 31. Compresión local

Si el navegador puede procesar la imagen:

```text
5 MB
↓
resize/compresión frontend
↓
aprox. 500-900 KB
```

Ventajas:

- menos almacenamiento local;
- menos datos móviles;
- menor tiempo de subida.

Si el navegador no puede decodificar un formato concreto, no debe bloquear la auditoría.

---

## 32. Cloudinary

Cloudinary debe:

- recibir uploads firmados;
- aplicar incoming transformations;
- reducir dimensiones;
- optimizar calidad;
- normalizar almacenamiento;
- servir versiones optimizadas.

No almacenar imágenes en MySQL.

MySQL guardará referencias y metadata necesaria.

---

## 33. La imagen no pasa por Express

```text
React
↓
POST /api/evidence/sign
↓
Express valida
↓
devuelve firma temporal
↓
React ─────────────► Cloudinary
```

Después:

```text
Cloudinary
↓
metadata/publicId
↓
React
↓
Express
↓
MySQL
```

Por este diseño Multer no es obligatorio.

---

## 34. Seguridad de Cloudinary

Nunca exponer `CLOUDINARY_API_SECRET` en frontend.

El frontend solo recibe datos de firma temporales necesarios para la subida.

---

## 35. Sesiones persistentes

No usar JWT solo por persistencia.

Arquitectura preferida:

```text
Cookie HttpOnly
+
Session en MySQL
```

Conceptualmente:

```text
sid=random_value
```

MySQL guarda:

```text
hash(sid)
userId
expiresAt
lastSeenAt
revokedAt
```

---

## 36. Duración de sesión

Objetivo UX: el usuario puede abrir la PWA después de semanas o meses sin iniciar sesión nuevamente.

Propuesta:

```text
ventana larga de inactividad
+
renovación deslizante al utilizar la app
```

No usar una sesión eterna sin expiración.

---

## 37. API caída no significa logout

Regla:

```text
401 real
→ invalidar sesión
```

Pero:

```text
timeout
offline
502
503
Cloudflare caído
```

NO debe provocar logout.

---

## 38. Web Push

Cada navegador/dispositivo tendrá su propia `PushSubscription`.

Un usuario puede tener múltiples dispositivos.

---

## 39. Push no es eterno

Una suscripción Web Push puede expirar o cambiar.

La aplicación debe ser autorrecuperable.

En cada apertura:

```text
getSubscription()
↓
comparar
↓
actualizar / renovar / registrar
```

No asumir que un endpoint Push es válido para siempre.

---

## 40. Notificaciones multicanal

Modelo conceptual:

```text
Notification
NotificationDelivery
```

Canales:

```text
PUSH
EMAIL
WHATSAPP
```

Ejemplo de reglas:

```text
Nueva asignación
→ Push

Faltan 2 días
→ Push

Último día
→ Push + WhatsApp

Vencida
→ Push + WhatsApp + Email
```

---

## 41. Persistencia de jobs

No depender únicamente de `node-cron`.

MySQL será la fuente de verdad.

```text
Notification
status = PENDING
scheduledAt = ...
```

El worker/tarea programada consulta pendientes.

Si PM2 reinicia, los pendientes siguen en MySQL y pueden retomarse.

---

## 42. Panel del auditor

Mobile-first.

Ejemplo:

```text
Hola, Juan

Agosto · Corte 2

Auditoría pendiente
Área: CORTE
Fecha límite: 28 Ago

[ INICIAR ]

Historial
Notificaciones
Perfil
```

---

## 43. Panel administrativo

Desktop-first.

Secciones:

```text
Dashboard
Resultados
Auditorías
Asignaciones
Formularios
Áreas
Usuarios
Notificaciones
Configuración
```

Indicadores:

```text
Resultado global
Cobertura
Pendientes
Vencidas
Top/Bottom áreas
Tendencias
```

---

## 44. UI y diseño Liquid Glass

Objetivo visual:

- moderno;
- limpio;
- no genérico;
- inspirado en Liquid Glass;
- buena profundidad;
- capas translúcidas puntuales;
- blur moderado;
- bordes suaves;
- reflejos sutiles;
- sombras difusas;
- radios amplios.

Evitar:

- exceso de blur;
- exceso de transparencia;
- estética genérica IA;
- controles con poco contraste;
- diseño que perjudique rendimiento móvil.

Controles importantes como Sí, No, Guardar, Enviar y Publicar deben tener contraste claro.

---

## 45. Backend modular

La estructura crecerá por módulos.

Ejemplo futuro:

```text
src/modules/

auth/
users/
areas/
forms/
cycles/
assignments/
audits/
evidence/
notifications/
reports/
```

Cada módulo puede seguir la convención:

```text
forms/
├── zod/
│   └── index.ts
├── 01_list.ts
├── 02_get.ts
├── 03_create.ts
├── 04_create_draft.ts
├── 05_update_draft.ts
├── 06_reorder.ts
├── 07_publish.ts
├── 08_versions.ts
├── helper.ts
└── routes.ts
```

No crear carpetas vacías antes de necesitarlas.

---

## 46. Frontend por funcionalidades

Propuesta:

```text
src/

app/
components/
features/
├── auth/
├── audits/
├── assignments/
├── forms/
├── areas/
├── users/
├── results/
├── notifications/
└── sync/

lib/
├── api/
├── offline/
└── pwa/

routes/
styles/
types/
```

Evitar un directorio `components/` gigantesco con toda la aplicación mezclada.

---

## 47. Reglas no negociables

1. `Published FormVersion` es inmutable.
2. `AuditCycle` congela la `FormVersion`.
3. `stableKey` de preguntas nunca depende del orden.
4. Resultados históricos nunca se recalculan con formularios actuales.
5. Áreas con históricos se desactivan, no se eliminan físicamente.
6. Usuarios con históricos se desactivan, no se eliminan físicamente.
7. Una auditoría duplicada puede existir.
8. Solo una auditoría cuenta oficialmente para una asignación/ciclo cuando corresponda.
9. Duplicados no se eliminan automáticamente.
10. `clientSubmissionId` debe ser único.
11. El backend calcula el resultado oficial.
12. Cada respuesta se guarda localmente antes de depender de red.
13. Error de red nunca debe provocar logout.
14. Cloudinary recibe imágenes directamente.
15. `CLOUDINARY_API_SECRET` nunca llega al frontend.
16. `PushSubscription` se considera renovable, no eterna.
17. Jobs/notificaciones persistentes viven en MySQL.
18. Históricos no dependen de la cantidad actual de áreas.
19. No usar la posición de columnas/campos como identidad.
20. No alterar auditorías enviadas para “adaptarlas” a una versión nueva.
21. No confiar en cálculos enviados por el frontend.
22. No borrar evidencia histórica salvo flujo administrativo explícito y auditable.
23. Acciones administrativas importantes deben quedar en `AuditLog`.
24. Formularios publicados solo generan nuevas versiones; no se editan directamente.
25. La verificacion QR por area es un candado ligero, no una prueba de GPS ni ubicacion.
26. La verificacion QR no altera puntaje, porcentaje, KPI ni oficialidad por si sola.

---

## 47.1 Verificacion ligera mediante codigo por area

Cada area tiene un `codigoVerificacion` unico para confirmar que el auditor tuvo
acceso al codigo fisico colocado en el area. Ese codigo puede imprimirse como
texto o representarse como QR.

No utiliza:

- GPS;
- geolocalizacion;
- latitud/longitud;
- NFC;
- selfies;
- tablas o campos de ubicacion.

El contenido de verificacion es el codigo simple del area:

```text
ABCD-2345
```

`codigoVerificacion` vive en MySQL. No hay versionado QR, HMAC ni secreto de
firma compartido con frontend.

Si el codigo no coincide con el area del objetivo, el backend rechaza el envio.
El envio valido guarda `verificadoEn`.

---

## 48. Orden de implementación

### Fase 1 — Arquitectura y reglas

Estado actual: definición y documentación.

### Fase 2 — Diseño completo de base de datos

Diseñar:

```text
User
Session
Area
Form
FormVersion
FormBlock
FormOption
FormRule
AuditCycle
AuditAssignment
GuestLink
AuditSubmission
AuditAnswer
AuditEvidence
PushSubscription
Notification
NotificationDelivery
AuditLog
```

No crear migration hasta validar el modelo.

### Fase 3 — Prisma + primera migration

- schema final;
- relaciones;
- índices;
- uniques;
- foreign keys;
- migration inicial;
- cliente Prisma;
- conexión MySQL.

### Fase 4 — Auth

- login;
- sesión persistente;
- logout;
- perfil;
- middleware de autenticación;
- renovación;
- revocación;
- manejo correcto de 401 vs errores de red.

### Fase 5 — Usuarios + roles + áreas

- CRUD usuarios;
- activación/desactivación;
- roles;
- CRUD áreas;
- tipo administrativa/operativa;
- validaciones.

### Fase 6 — Constructor de formularios

- crear Form;
- crear Draft;
- bloques;
- drag & drop;
- opciones;
- `CRITERIO_5S`;
- preview;
- publish;
- versiones;
- archivado.

### Fase 7 — Ciclos y asignaciones

- dos cortes mensuales;
- asignaciones;
- borrador;
- publicación;
- validaciones;
- rotación futura.

### Fase 8 — Auditoría mobile

- render dinámico;
- respuestas;
- navegación;
- autosave;
- firma;
- hallazgo;
- evidencia;
- scoring provisional.

### Fase 9 — Offline

- IndexedDB;
- drafts locales;
- cola de sincronización;
- idempotencia;
- reintentos;
- estados de sync.

### Fase 10 — Cloudinary

- firma;
- compresión frontend;
- incoming transformation;
- formatos móviles;
- metadata;
- evidencias;
- firmas.

### Fase 11 — Invitados

- GuestLink;
- token;
- nombre;
- selección/confirmación de área;
- advertencia de duplicado;
- auditoría adicional.

### Fase 12 — Scoring

- backend como autoridad;
- scoreEarned;
- scorePossible;
- percentage;
- snapshots;
- oficial/adicional/inválida.

### Fase 13 — Dashboard y KPI

- global;
- áreas;
- tendencias;
- cobertura;
- históricos;
- comparativos;
- exportación futura.

### Fase 14 — Notificaciones

- Web Push;
- email;
- WhatsApp;
- reglas;
- recordatorios;
- reintentos;
- persistencia.

### Fase 15 — PWA

- instalación;
- service worker;
- actualización;
- reconexión;
- resync;
- recuperación de PushSubscription.

### Fase 16 — Hardening

- seguridad;
- rate limits específicos;
- permisos;
- logs;
- backups;
- auditoría;
- recuperación;
- validación de uploads;
- control de errores.

### Fase 17 — Despliegue inicial

- Netlify frontend;
- backend local;
- PM2;
- Cloudflare Tunnel;
- MySQL local;
- dominios;
- variables.

### Fase 18 — Portabilidad Railway

Dejar documentado:

- dump/import MySQL;
- variables;
- deploy backend;
- cambio DNS;
- healthcheck;
- rollback.

Sin cambios de arquitectura.

---

## 49. Decisiones pendientes antes del schema definitivo

Antes de crear el modelo Prisma completo, resolver:

1. Definición exacta de los dos cortes mensuales.
2. Si existe respuesta `NO_APLICA`.
3. Si `NO` obliga siempre a escribir hallazgo.
4. Si `NO` obliga siempre a adjuntar evidencia.
5. Si el resultado global será promedio simple por área.
6. Si todas las áreas pesan igual.
7. Reglas exactas para auditoría oficial vs adicional.
8. Cuándo caduca un `GuestLink`.
9. Cuántas auditorías puede delegar un usuario.
10. Ventana exacta de sesión persistente.
11. Políticas de reintento para Push/Email/WhatsApp.
12. Qué información debe poder ver `VIEWER`.

---

## 50. Principio general del proyecto

El sistema debe priorizar:

```text
robustez
+
trazabilidad
+
históricos inmutables
+
offline
+
mobile
+
simplicidad de operación
```

sobre:

```text
abstracciones innecesarias
+
frameworks excesivos
+
automatizaciones frágiles
+
dependencia de posiciones
+
borrado destructivo
```

La aplicación debe ser sencilla para el auditor y estricta internamente con la integridad de los datos.
