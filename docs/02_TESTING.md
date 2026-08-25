# Pruebas del Backend

## La aplicación jamás depende de tests

Queda prohibido que código dentro de src/ importe cualquier archivo desde:

.tmp/
tests/
*.test.ts
*.spec.ts

Los tests tampoco pueden convertirse accidentalmente en fuente permanente de:

- tipos
- interfaces
- constantes
- mocks necesarios en producción
- helpers necesarios en producción
- configuración
- lógica de negocio
- fixtures necesarias para ejecutar la app

Si durante una prueba se crea algo que realmente necesita producción, debe moverse conscientemente a la ubicación correcta dentro de src/.

## Build y ejecución

La aplicación debe:

- compilar sin `.tmp/`;
- arrancar sin `.tmp/`;
- ejecutar `bun run start` sin tests;
- ejecutar typecheck de producción sin depender de tests;
- funcionar aunque no exista ningún `.test.ts`.

## Tests permanentes

Por defecto NO crear tests permanentes.

Si el usuario autoriza tests permanentes, utilizar exclusivamente:

tests/

Ejemplo:

tests/
├── unit/
└── integration/

Nunca:

src/tests/

Incluso los tests permanentes deben estar completamente separados del runtime de producción.

## Scripts de prueba

No dejar scripts experimentales permanentes en:

scripts/

Un script creado únicamente para verificar una tarea también debe considerarse temporal.

Debe utilizar:

.tmp/

y eliminarse al finalizar.

## Antes de cerrar cualquier tarea

El agente debe comprobar explícitamente:

- no hay `.test.ts` temporales;
- no hay `.spec.ts` temporales;
- no existen pruebas dentro de `src/`;
- `.tmp/` está limpio o eliminado;
- producción no importa código de pruebas;
- typecheck funciona;
- la aplicación puede arrancar sin tests;
- no quedaron archivos de diagnóstico temporales.
