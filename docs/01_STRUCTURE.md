# Estructura del Backend

## Principio principal

El backend debe crecer únicamente según necesidades reales.

No crear carpetas, capas, servicios, helpers o abstracciones "por si acaso".

src/ contiene exclusivamente código de producción.

## Estructura general esperada

backend/
├── prisma/
│   ├── migrations/
│   ├── schema.prisma
│   └── seed.ts
│
├── src/
│   ├── config/
│   ├── db/
│   ├── middlewares/
│   ├── modules/
│   ├── utils/
│   ├── app.ts
│   └── index.ts
│
├── docs/
├── scripts/        # solo si realmente son necesarios
├── .tmp/           # temporal, ignorado por Git
├── AGENTS.md
├── README.md
├── .env
├── .env.example
├── .gitignore
├── bun.lock
├── ecosystem.config.cjs
├── package.json
└── tsconfig.json

IMPORTANTE:
No es obligatorio crear todas estas carpetas desde el inicio.
Deben aparecer cuando exista una necesidad real.

## Módulos

Toda funcionalidad de negocio debe agruparse dentro de:

src/modules/<nombre-modulo>/

Ejemplo:

src/modules/departamentos/
├── zod/
│   └── index.ts
├── 01_list.ts
├── 02_create.ts
├── 03_update.ts
├── 04_patch.ts
├── helper.ts
└── routes.ts

Otro ejemplo:

src/modules/auth/
├── zod/
│   └── index.ts
├── 01_login.ts
├── 02_register.ts
├── 03_profile.ts
├── 04_change_password.ts
├── 05_forgot_password.ts
├── 06_reset_password.ts
├── 07_refresh.ts
├── 08_logout.ts
├── helper.ts
└── routes.ts

Los números se utilizan exclusivamente para mantener un orden visual y lógico.

No cambiar esta convención sin autorización.

## Archivos por responsabilidad

Cada archivo debe representar una acción o responsabilidad claramente identificable.

Evitar archivos gigantes que mezclen:

- listar
- crear
- actualizar
- eliminar
- validar
- helpers

Todo en el mismo archivo.

Al mismo tiempo, NO crear automáticamente estructuras como:

controller/
service/
repository/
dto/
mapper/
use-cases/

solo por seguir patrones arquitectónicos.

Crear capas adicionales únicamente cuando la complejidad real lo justifique.

## Zod

Las validaciones específicas de cada módulo viven dentro de:

src/modules/<modulo>/zod/

Por defecto:

zod/index.ts

Ejemplo:

src/modules/departamentos/zod/index.ts

Si el módulo crece mucho se permite:

zod/
├── create.ts
├── update.ts
├── query.ts
└── index.ts

pero únicamente si existe necesidad real.

No crear un src/schemas global para schemas exclusivos de módulos.

## routes.ts

Cada módulo registra sus propias rutas.

Ejemplo:

src/modules/auth/routes.ts
src/modules/departamentos/routes.ts

No crear un src/routes/ separado con un archivo por cada módulo.

src/app.ts debe limitarse principalmente a:

- middlewares globales
- registrar routers principales
- manejo de errores
- 404

## helper.ts

helper.ts es opcional.

Solo debe existir cuando haya lógica reutilizada por varios archivos del mismo módulo.

No crear helper.ts vacío.

No convertir helper.ts en un archivo gigantesco.

Si una utilidad pertenece a toda la aplicación, evaluar moverla a:

src/utils/

## Middlewares

Los middlewares verdaderamente globales viven en:

src/middlewares/

Ejemplos:

authenticate.ts
authorize.ts
validate.ts
error-handler.ts

Si un middleware solamente pertenece a un módulo, mantenerlo dentro del módulo.

## Utils

src/utils/ contiene solamente utilidades compartidas por varios módulos.

Ejemplos potenciales:

cloudinary.ts
logger.ts

No utilizar utils/ como carpeta para código que no sabemos dónde colocar.

## Base de datos

Prisma vive exclusivamente en:

prisma/

Las migraciones viven en:

prisma/migrations/

Las migraciones son historial legítimo de la base de datos.

No eliminarlas durante tareas de "limpieza".

src/db/ contiene exclusivamente la inicialización/acceso común a la base de datos.

## Scripts

scripts/ solo se crea si existen tareas manuales reales como:

- importaciones
- migraciones especiales
- reparación controlada de datos
- operaciones administrativas

Los scripts temporales de diagnóstico NO deben quedar permanentemente en scripts/.

## Package manager

El proyecto usa exclusivamente Bun.

Debe existir:

bun.lock

NO deben existir:

package-lock.json
yarn.lock
pnpm-lock.yaml

No utilizar:

npm install
npm run
yarn
pnpm

Usar:

bun install
bun add
bun run
bunx

## Producción

El mismo backend debe poder ejecutarse:

1. Servidor local:
   Bun + Express + MySQL local + PM2 + Cloudflare Tunnel

2. Railway:
   Bun + Express + MySQL Railway

La lógica de aplicación NO debe depender de dónde esté desplegada.

Las diferencias entre entornos deben resolverse mediante variables de entorno.

No introducir rutas absolutas específicas del servidor.

No introducir código del tipo:

if (railway) ...
if (local) ...

si la diferencia puede resolverse mediante configuración.

## Regla final

Antes de crear una nueva carpeta o nueva convención estructural:

1. revisar este documento;
2. comprobar que no existe ya un lugar correcto;
3. crearla únicamente si existe una necesidad real.
