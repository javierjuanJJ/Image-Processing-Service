# Tasks — Feature 002 Carga de Imágenes

## Middlewares

- [x] T1. Crear `backend/middlewares/upload.js`: multer `memoryStorage`, campo `image`, `limits.fileSize` desde config, `fileFilter` con lista blanca.
- [x] T2. Extender `error-handler.js`: mapear `MulterError LIMIT_FILE_SIZE` → 413 y filtro mime → 400.

## Config

- [x] T3. Añadir a `config.js`: `uploadsDir`, `upload.{maxFileSizeMB, allowedMimeTypes}`; añadir `uploads/` a `.gitignore`.

## Capa schema

- [x] T4. Crear `backend/schemas/image.schema.js`: `imageSchema` (filename sanitizado, mimeType enum, size int positivo), `imageListQuerySchema` (page/limit coerce), exports `validateImage` / `validatePartialImage`.

## Servicios

- [x] T5. Crear `backend/services/sharp.service.js` con `getImageMetadata(buffer)` → `{ mimeType, width, height, size, ext }`; throw si el formato no está soportado.

## Capa modelo

- [x] T6. Crear `backend/models/image.model.js`: `create`, `getById`, `list` (transacción findMany+count, orderBy createdAt desc, skip/take).

## Controller

- [x] T7. Implementar `imageController.create` en `backend/controllers/image.controller.js`: guard de file ausente → 400; metadatos sharp → 400 si falla; sanitizar filename con Zod; escribir a `uploads/{yyyy}/{mm}/{uuid}{ext}` con mkdir recursivo y cleanup con unlink en fallo; persistir vía modelo; responder 201 con shape completo (`url` incluida).

## Rutas

- [x] T8. Crear `backend/routes/image.routes.js`: `POST /images` = `verifyToken → uploadSingle → create`.
- [x] T9. Montar image routes en `routes/index.js` bajo `/api/v1`.

## Docs y tests

- [x] T10. Actualizar OpenAPI: `POST /api/v1/images` + componente `Image` + respuestas 400/401/413.
- [x] T11. Tests e2e en `app.test.js`: fixture PNG generada con sharp en runtime; validar 201 (shape + dimensiones reales), 401 sin token, 400 sin file, 400 contenido inválido; cleanup de uploads en `after`.
- [x] T12. Verificar que un registro duplicado de nombre NO colisiona (ids uuid distintos) — cubierto implícitamente por T11; añadir aserto de ids distintos.
- [x] T13. Actualizar estado en `spec/constitution/roadmap.md`.

> ⚠️ Sin BD disponible: escribir código y tests SIN ejecutarlos; validación posterior por quien tenga PostgreSQL.
