# Tasks — Feature 005 Listado Paginado

## Controller y rutas

- [x] T1. Implementar `imageController.getAll`: leer `page/limit` normalizados por Zod, llamar a `imageModel.list`, responder 200 con `{ data, pagination }` (summaries + url, sin variants).
- [x] T2. Añadir ruta `GET /images` con `verifyToken` + `validate(imageListQuerySchema, 'query')`.
- [x] T3. Verificar que el middleware `validate` soporta `source='query'` y reescribe `req.query` con valores coercidos/defaults.

## Modelo (verificación)

- [x] T4. Confirmar que `imageModel.list` usa `$transaction([findMany, count])`, `orderBy: createdAt desc (+ id desc)` y el índice compuesto `[userId, createdAt(sort: Desc)]` está en `schema.prisma`.

## Docs y tests

- [x] T5. Actualizar OpenAPI: `GET /images` con parámetros page/limit y schema `ImagePage` (`ImageSummary`).
- [x] T6. Tests e2e: defaults (página 1/limit 10), orden descendente, aislamiento por usuario (dos usuarios), paginación real (limit=2 sobre 3 registros → página 2 con 1 item), página fuera de rango → data vacía, límites inválidos → 400, sin token → 401.
- [x] T7. Actualizar estado en `spec/constitution/roadmap.md`.

> ⚠️ Sin BD: código y tests escritos sin ejecutar; validación posterior con PostgreSQL real.
