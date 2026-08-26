# Feature 002 — Carga de Imágenes

## Resumen

Permitir a un usuario autenticado subir una imagen vía `multipart/form-data`. El servicio almacena el binario en disco (`uploads/`) y persiste los metadatos (nombre, mime, tamaño, dimensiones) en PostgreSQL a través de Prisma.

## Casos de uso

1. **Como usuario autenticado**, quiero subir un JPEG/PNG/WEBP/GIF/AVIF y recibir su registro con id y URL de acceso.
2. **Como API**, debo rechazar archivos > `maxFileSizeMB` (10 MB por defecto) o con mime no permitido.
3. **Como API**, debo extraer dimensiones reales con `sharp` metadata al momento de la carga.
4. **Como sistema**, cada imagen queda ligada al `userId` del token; nadie más puede verla.

## Contrato OpenAPI

```yaml
paths:
  /api/v1/images:
    post:
      summary: Sube una imagen
      tags: [Images]
      security: [{ bearerAuth: [] }]
      requestBody:
        required: true
        content:
          multipart/form-data:
            schema:
              type: object
              required: [image]
              properties:
                image:
                  type: string
                  format: binary
                  description: Campo file del form-data
                filename:
                  type: string
                  description: Opcional; si se omite se usa el original sanitizado
      responses:
        '201':
          description: Imagen registrada
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Image'
              example:
                id: b3c1d9e0-7f2a-4c8e-9a11-0d5f6a2b8c90
                filename: foto-playa.jpg
                mimeType: image/jpeg
                size: 482113
                width: 1920
                height: 1080
                url: /api/v1/images/b3c1d9e0-7f2a-4c8e-9a11-0d5f6a2b8c90/file
                createdAt: '2026-08-26T10:00:00.000Z'
        '400':
          description: Archivo ausente, mime no permitido o tamaño excedido
          content:
            application/json:
              examples:
                noFile: { value: { error: 'No image file provided' } }
                badMime: { value: { error: 'Unsupported image type', details: ['image/pdf'] } }
        '401': { $ref: '#/components/responses/Unauthorized' }

components:
  schemas:
    Image:
      type: object
      properties:
        id: { type: string, format: uuid }
        filename: { type: string }
        mimeType: { type: string }
        size: { type: integer, description: bytes del original }
        width: { type: integer, nullable: true }
        height: { type: integer, nullable: true }
        url: { type: string, description: Ruta relativa para descargar el binario }
        createdAt: { type: string, format: date-time }
```

Respuesta `201` — shape exacto:

```json
{
  "id": "b3c1d9e0-...",
  "filename": "foto-playa.jpg",
  "mimeType": "image/jpeg",
  "size": 482113,
  "width": 1920,
  "height": 1080,
  "url": "/api/v1/images/<id>/file",
  "createdAt": "2026-08-26T10:00:00.000Z"
}
```

## Reglas de negocio

- Autenticación obligatoria (`verifyToken`); `userId` SIEMPRE del token, jamás del body.
- Multer en modo `memoryStorage` + `limits.fileSize = config.upload.maxFileSizeMB * 1024 * 1024`.
- Mime permitidos: `image/jpeg`, `image/png`, `image/webp`, `image/gif`, `image/avif` (lista en `config.js`).
- Validación real de contenido con `sharp(buffer).metadata()` — un `.exe` renombrado a `.jpg` falla aquí ⇒ 400 `Invalid image content`.
- Nombre de archivo en disco: `${uuid}${ext}` (ext derivada del mime detectado por sharp) — nunca confiar en el nombre del cliente.
- `filename` visible del cliente se sanitiza (sin rutas, sin caracteres de control), máx 255 chars.
- El binario se escribe en `uploads/{yyyy}/{mm}/{id}{ext}` tras validar metadatos (escritura atómica: escribir a temp y renombrar).
- Si sharp falla o Prisma falla ⇒ el archivo temporal se elimina (no dejar huérfanos).

## Criterios de aceptación

- [ ] Upload válido con token ⇒ `201` con el shape JSON completo y el archivo existe físicamente en disco.
- [ ] Sin token ⇒ `401`.
- [ ] Sin campo file ⇒ `400 { error: 'No image file provided' }`.
- [ ] Mime fuera de lista (p. ej. PDF) ⇒ `400 Unsupported image type`.
- [ ] Archivo > límite configurado ⇒ `400`/`413` (decisión: multer aborta antes; responder `413 Payload Too Large`).
- [ ] Binario corrupto que sharp no puede leer ⇒ `400 Invalid image content`.
- [ ] Metadatos persistidos correctos: `size` coincide con bytes reales, `width`/`height` coinciden con las dimensiones reales del archivo.
- [ ] Dos uploads idénticos generan dos registros distintos (ids únicos, sin colisión de nombres).
- [ ] Test e2e sube una imagen fixture pequeña (PNG generado en test con `sharp`) y valida el contrato completo.
