# Feature 003 — Transformación de Imágenes

## Resumen

Aplicar transformaciones a una imagen existente usando `sharp`: **resize**, **crop**, **rotate**, **conversión de formato** y filtros **grayscale/sepia**. El resultado se almacena como una *variante* de la imagen original (no se muta el original) y queda accesible vía la URL de variantes. Operaciones pesadas pueden encolarse con RabbitMQ cuando `QUEUE_ENABLED=true`.

## Casos de uso

1. **Como usuario**, quiero pedir un thumbnail 300×300 en WEBP de mi imagen y recibir inmediatamente los metadatos del resultado.
2. **Como usuario**, quiero recortar (crop) una región concreta `{ left, top, width, height }`.
3. **Como usuario**, quiero rotar cualquier ángulo múltiplo de 90 y aplicar filtro grayscale o sepia.
4. **Como sistema**, el original JAMÁS se modifica; cada transformación produce una nueva variante versionada.
5. **Como operador**, cuando hay carga alta activo `QUEUE_ENABLED` y las transformaciones se procesan por RabbitMQ (estado `pending → done|failed` consultable).

## Contrato OpenAPI

```yaml
paths:
  /api/v1/images/{id}/transform:
    post:
      summary: Aplica una transformación y crea una variante
      tags: [Images]
      security: [{ bearerAuth: [] }]
      parameters:
        - name: id
          in: path
          required: true
          schema: { type: string, format: uuid }
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/TransformRequest'
            examples:
              resizeWebp:
                value:
                  resize: { width: 300, height: 300, fit: cover }
                  format: webp
              cropGrayscale:
                value:
                  crop: { left: 10, top: 10, width: 500, height: 500 }
                  filters: { grayscale: true }
              rotateSepiaJpeg:
                value:
                  rotate: 90
                  filters: { sepia: true }
                  format: jpeg
      responses:
        '202':
          description: Transformación aceptada (modo cola activo)
          content:
            application/json:
              example: { status: pending, transformId: clx9f2... }
        '201':
          description: Variante creada (procesamiento síncrono)
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ImageVariant'
              example:
                imageId: b3c1d9e0-...
                variantId: v_7d2c8a
                url: /api/v1/images/b3c1d9e0-.../variants/v_7d2c8a
                mimeType: image/webp
                size: 51240
                width: 300
                height: 300
                appliedTransforms: [resize, format]
        '400': { description: Payload inválido o sin transformaciones }
        '401': { $ref: '#/components/responses/Unauthorized' }
        '404': { description: Imagen no encontrada o no pertenece al usuario }

components:
  schemas:
    TransformRequest:
      type: object
      minProperties: 1
      properties:
        resize:
          type: object
          properties:
            width:  { type: integer, minimum: 1, maximum: 8000 }
            height: { type: integer, minimum: 1, maximum: 8000 }
            fit:    { type: string, enum: [cover, contain, fill, inside, outside], default: cover }
          anyOf: [{ required: [width] }, { required: [height] }]
        crop:
          type: object
          required: [left, top, width, height]
          properties:
            left:   { type: integer, minimum: 0 }
            top:    { type: integer, minimum: 0 }
            width:  { type: integer, minimum: 1 }
            height: { type: integer, minimum: 1 }
        rotate:
          type: integer
          enum: [0, 90, 180, 270]
        filters:
          type: object
          properties:
            grayscale: { type: boolean }
            sepia:     { type: boolean }
        format:
          type: string
          enum: [jpeg, png, webp, avif, gif]
    ImageVariant:
      type: object
      properties:
        imageId:   { type: string, format: uuid }
        variantId: { type: string }
        url:       { type: string }
        mimeType:  { type: string }
        size:      { type: integer }
        width:     { type: integer, nullable: true }
        height:    { type: integer, nullable: true }
        appliedTransforms: { type: array, items: { type: string } }
```

## Reglas de negocio

- El payload debe contener **al menos una** operación (`resize | crop | rotate | filters | format`); payload vacío ⇒ 400.
- Orden de aplicación canónico (pipeline sharp): `rotate → crop(extract) → resize → filters(modulate/tint/grayscale) → format(toFormat)`.
- `crop` validado contra dimensiones reales: si `left+width > image.width` ⇒ 400 `Crop out of bounds`.
- Sepia NO es nativo de sharp como preset: se implementa con `modulate({ saturation }) + tint()`. Grayscale usa `.grayscale(true)`.
- Variantes nombradas `${variantId}` = hash corto (8 chars) de JSON.stringify(transforms ordenado) — determinista: misma operación sobre misma imagen ⇒ misma variante reutilizada (idempotencia).
- Almacén: `uploads/{yyyy}/{mm}/{imageId}/{variantId}.{ext}`. Registro de variante en `Image.variants` (Json): `{ [variantId]: { path, mimeType, size, width, height, transforms } }`.
- Cada request registra un `TransformLog` (`pending`) que pasa a `done`/`failed`.
- Modo cola (`config.queueEnabled=true`): responder `202 { status: 'pending', transformId }`; worker consume y actualiza estado + variante. En modo síncrono responde `201` directo.
- Ownership: si la imagen no existe o `image.userId !== req.user.sub` ⇒ 404 (no revelar existencia).

## Criterios de aceptación

- [ ] Resize+format válido ⇒ `201` con variante cuyo binario existe, dimensiones correctas y mime según formato pedido.
- [ ] Mismo payload repetido ⇒ misma `variantId`, no duplica archivo (idempotente).
- [ ] Crop fuera de límites ⇒ `400 Crop out of bounds`.
- [ ] Rotate solo acepta 0/90/180/270 ⇒ otro valor ⇒ 400.
- [ ] Filtros combinables: grayscale+sepia simultáneos permitidos (sepia gana tras grayscale).
- [ ] Payload vacío `{}` ⇒ 400.
- [ ] Imagen ajena/inexistente ⇒ 404 sin detalle.
- [ ] Original intacto: bytes del archivo original idénticos antes/después.
- [ ] Con `QUEUE_ENABLED=true`: respuesta 202 y la variante aparece tras procesar el worker; log pasa a done.
- [ ] Tests e2e cubren escenarios 1–3, 5–8.

## Ejemplo de pipeline Sharp (referencia)

```js
import sharp from 'sharp'

export async function transform(buffer, t) {
  let img = sharp(buffer)
  if (t.rotate && t.rotate !== 0) img = img.rotate(t.rotate)
  if (t.crop) img = img.extract({ left: t.crop.left, top: t.crop.top, width: t.crop.width, height: t.crop.height })
  if (t.resize) img = img.resize({
    width: t.resize.width, height: t.resize.height,
    fit: t.resize.fit ?? 'cover',
    withoutEnlargement: false
  })
  if (t.filters?.grayscale) img = img.grayscale(true)
  if (t.filters?.sepia) {
    // pseudo-sepia: desaturar parcialmente + tinte cálido
    img = img.modulate({ saturation: 0.55 }).tint({ r: 255, g: 200, b: 140 })
  }
  if (t.format) img = img.toFormat(t.format, t.format === 'jpeg' ? { quality: 85 } : {})
  return { data: await img.toBuffer(), info: await img.metadata() }
}
```
