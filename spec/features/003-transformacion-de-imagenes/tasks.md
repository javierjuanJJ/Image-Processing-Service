# Tasks — Feature 003 Transformación de Imágenes

## Schema

- [x] T1. Añadir a `schemas/image.schema.js`: `resizeSchema`, `transformImageSchema` (refine "at least one transformation"), exports `validateTransformImage` / `validatePartialTransformImage`.

## Servicio Sharp

- [x] T2. Extender `services/sharp.service.js`: mapas `EXT_BY_FORMAT`/`MIME_BY_FORMAT`.
- [x] T3. Implementar `variantIdFor(imageId, transforms)` (sha256 8 chars, determinista).
- [x] T4. Implementar `transform(buffer, t)` pipeline ordenado: rotate → extract(crop, con validación bounds y error `.status=400`) → resize → grayscale → sepia (modulate+tint) → toFormat(jpeg quality 85); devolver `{ data, mimeType, ext, size, width, height }`.

## Modelo

- [x] T5. Añadir `imageModel.addVariant` (merge sobre campo Json `variants`) y acceso de lectura de variante.
- [x] T6. Crear `models/transform.model.js`: `createLog`, `markDone`, `markFailed`.

## Controller

- [x] T7. Implementar `imageController.transform`: ownership 404; idempotencia por variantId; branch cola (`202 pending`) vs síncrono (`201`); catch de err.status 400 → respuesta de negocio.
- [x] T8. Implementar helper `buildVariantResponse(image, variantId, v)`.

## Rutas

- [x] T9. Añadir rutas: `POST /images/:id/transform` (verifyToken + validate(transformImageSchema)) y `GET /images/:id/variants/:variantId` (verifyToken).
- [x] T10. Implementar `getVariantFile` con Content-Type correcto y 404 para variantes inexistentes.

## Cola opcional

- [x] T11. Crear `services/queue.service.js` (publish durable + consume con prefetch 1, ack/nack).
- [x] T12. Crear `workers/transform.worker.js` reutilizando sharpService/imageModel; marcar done/failed en el log.
- [x] T13. Cablear feature-flag: `config.queueEnabled` decide flujo síncrono/202; documentar comando del worker en README.

## Docs y tests

- [x] T14. Actualizar OpenAPI: `POST /images/{id}/transform` (201/202/400/401/404), schemas `TransformRequest`/`ImageVariant`, y endpoint de variante.
- [x] T15. Tests e2e (modo síncrono): resize+webp 201; repetición idempotente (misma variantId); crop out-of-bounds 400; rotate inválido 400; payload vacío 400; imagen ajena 404; original sin modificar (comparar bytes antes/después).
- [x] T16. Actualizar estado en `spec/constitution/roadmap.md`.

> ⚠️ Sin BD/RabbitMQ disponibles: dejar código y tests escritos SIN ejecutar; validación posterior contra servicios reales.
