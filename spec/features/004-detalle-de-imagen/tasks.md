# Tasks — Feature 004 Detalle e Imagen

## Controller

- [x] T1. Implementar `imageController.getId`: ownership 404; serializar shape `ImageDetail` con mapa `variants` (urls absolutas relativas, `{}` si vacío).
- [x] T2. Implementar `imageController.getFile`: ownership 404; `stat` del binario → 404 `File missing`; headers Content-Type/Length/Cache-Control; `?download=1` → Content-Disposition attachment.

## Rutas

- [x] T3. Añadir `GET /images/:id` y `GET /images/:id/file` con `verifyToken`.

## Docs y tests

- [x] T4. Actualizar OpenAPI: endpoints + schemas `ImageDetail` / `VariantMeta`.
- [x] T5. Tests e2e: detalle propio 200 (shape), ajeno 404, file 200 byte-idéntico + Content-Type, download=1 header, sin token 401, binario ausente 404 File missing.
- [x] T6. Actualizar estado en `spec/constitution/roadmap.md`.

> ⚠️ Sin BD: código y tests escritos sin ejecutar; validación posterior con PostgreSQL real.
