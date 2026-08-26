# Feature 004 — Obtención de Detalle e Imagen

## Resumen

Permitir al propietario consultar los metadatos completos de una imagen (`GET /images/:id`) y descargar el binario original (`GET /images/:id/file`). Reutiliza el modelo y el patrón de ownership de las features anteriores.

## Casos de uso

1. **Como usuario**, quiero ver los metadatos de una imagen mía (nombre, dimensiones, tamaño, fecha, variantes disponibles).
2. **Como cliente HTTP**, quiero descargar el archivo original con su Content-Type correcto para renderizarlo en `<img src>`.
3. **Como API**, debo responder 404 cuando la imagen no existe O pertenece a otro usuario (sin filtrar existencia).

## Contratos OpenAPI

```yaml
paths:
  /api/v1/images/{id}:
    get:
      summary: Detalle de una imagen
      tags: [Images]
      security: [{ bearerAuth: [] }]
      parameters:
        - { name: id, in: path, required: true, schema: { type: string, format: uuid } }
      responses:
        '200':
          description: Metadatos de la imagen
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ImageDetail'
        '401': { $ref: '#/components/responses/Unauthorized' }
        '404':
          description: No existe o no es del usuario autenticado
          content:
            application/json:
              example: { error: 'Image not found' }

  /api/v1/images/{id}/file:
    get:
      summary: Descarga el binario original
      tags: [Images]
      security: [{ bearerAuth: [] }]
      parameters:
        - { name: id, in: path, required: true, schema: { type: string, format: uuid } }
      responses:
        '200':
          description: Binario de la imagen
          content:
            image/png:
              schema: { type: string, format: binary }
        '401': { $ref: '#/components/responses/Unauthorized' }
        '404': { $ref: '#/components/responses/NotFound' }

components:
  schemas:
    ImageDetail:
      type: object
      properties:
        id: { type: string, format: uuid }
        filename: { type: string }
        mimeType: { type: string }
        size: { type: integer }
        width: { type: integer, nullable: true }
        height: { type: integer, nullable: true }
        url: { type: string }
        variants:
          type: object
          additionalProperties:
            $ref: '#/components/schemas/VariantMeta'
        createdAt: { type: string, format: date-time }
    VariantMeta:
      type: object
      properties:
        url: { type: string }
        mimeType: { type: string }
        size: { type: integer }
        width: { type: integer, nullable: true }
        height: { type: integer, nullable: true }
```

Ejemplo `200`:

```json
{
  "id": "b3c1d9e0-...",
  "filename": "foto-playa.jpg",
  "mimeType": "image/jpeg",
  "size": 482113,
  "width": 1920,
  "height": 1080,
  "url": "/api/v1/images/b3c1d9e0-.../file",
  "variants": {
    "v_7d2c8a": {
      "url": "/api/v1/images/b3c1d9e0-.../variants/v_7d2c8a",
      "mimeType": "image/webp",
      "size": 51240,
      "width": 300,
      "height": 300
    }
  },
  "createdAt": "2026-08-26T10:00:00.000Z"
}
```

## Reglas de negocio

- Ambos endpoints requieren JWT; ownership estricto: `image.userId === req.user.sub`, si no ⇒ **404** (nunca 403; no revelar existencia).
- `/file` sirve con `Content-Type = image.mimeType` y soporte de descarga opcional vía query `?download=1` ⇒ header `Content-Disposition: attachment; filename="..."` con el filename sanitizado.
- Si el registro existe pero el binario no está en disco ⇒ 404 `{ error: 'File missing' }` (estado inconsistente detectable).
- Headers útiles en `/file`: `Content-Length`, `Cache-Control: private, max-age=3600`.

## Criterios de aceptación

- [ ] `GET /images/:id` propio ⇒ 200 con shape completo incluido mapa `variants` (vacío `{}` si no hay).
- [ ] `GET /images/:id` ajeno/inexistente ⇒ 404 idéntico.
- [ ] Sin token ⇒ 401 en ambos endpoints.
- [ ] `GET /images/:id/file` ⇒ 200 binario byte a byte idéntico al original subido, Content-Type correcto.
- [ ] `?download=1` añade Content-Disposition attachment.
- [ ] Binario borrado manualmente ⇒ 404 `File missing`.
- [ ] Tests e2e cubren todos los escenarios.
