# AGENTS.md — Backend Encuestas de 5S

Estas instrucciones aplican a todo el backend.

Antes de modificar código, leer obligatoriamente:

- `docs/01_STRUCTURE.md`
- `docs/02_TESTING.md`

## Principios generales

- Backend basado en Bun + TypeScript strict + Express.
- Base de datos MySQL mediante Prisma.
- Validación con Zod.
- No utilizar `any` salvo caso excepcional debidamente justificado.
- No introducir estructuras, carpetas o abstracciones nuevas sin necesidad real.
- No mezclar código de pruebas con código de producción.
- No colocar archivos `.test.ts` dentro de `src/`.
- La aplicación jamás debe depender de archivos de prueba para funcionar, compilar o arrancar.
- Mantener los módulos autocontenidos.
- No usar npm, pnpm o yarn. El proyecto usa Bun.
- No generar `package-lock.json`.

## Estructura

Las reglas completas están en:

`docs/01_STRUCTURE.md`

No crear nuevas convenciones de carpetas sin revisar primero ese documento.

## Pruebas

Las reglas completas están en:

`docs/02_TESTING.md`

Las pruebas creadas por el agente durante una tarea son temporales salvo que el usuario indique explícitamente lo contrario.

## Antes de finalizar una tarea

- Ejecutar typecheck.
- Ejecutar lint si está configurado.
- Verificar que la aplicación arranque.
- Eliminar pruebas y archivos temporales creados durante la tarea.
- Verificar que no queden `.test.ts` temporales.
- Verificar que producción no importe nada desde carpetas temporales o de tests.
