# Plan Técnico — Feature 003 Transformación de Imágenes

## Archivos a crear/modificar

| Archivo | Acción | Responsabilidad |
|---|---|---|
| `backend/schemas/image.schema.js` | modificar | Añadir `transformImageSchema` + validadores |
| `backend/services/sharp.service.js` | modificar | Pipeline `transform(buffer, t)`, `variantIdFor` |
| `backend/services/queue.service.js` | crear (opcional) | publish/consume RabbitMQ |
| `backend/workers/transform.worker.js` | crear (opcional) | proceso consumidor |
| `backend/models/image.model.js` | modificar | `addVariant` sobre campo Json `variants` |
| `backend/models/transform.model.js` | crear | logs pending/done/failed |
| `backend/controllers/image.controller.js` | modificar | métodos `transform`, `getVariantFile` |
| `backend/routes/image.routes.js` | modificar | POST `/:id/transform`, GET `/:id/variants/:variantId` |

## 1. Schema Zod del transform

```js
const resizeSchema = z.object({
  width: z.number().int().min(1).max(8000).optional(),
  height: z.number().int().min(1).max(8000).optional(),
  fit: z.enum(['cover', 'contain', 'fill', 'inside', 'outside']).default('cover')
}).refine(v => v.width != null || v.height != null, { message: 'resize requires width or height' })

export const transformImageSchema = z.object({
  resize: resizeSchema.optional(),
  crop: z.object({
    left: z.number().int().min(0),
    top: z.number().int().min(0),
    width: z.number().int().min(1),
    height: z.number().int().min(1)
  }).optional(),
  rotate: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]).optional(),
  filters: z.object({
    grayscale: z.boolean().optional(),
    sepia: z.boolean().optional()
  }).optional(),
  format: z.enum(['jpeg', 'png', 'webp', 'avif', 'gif']).optional()
}).refine(
  v => v.resize || v.crop || v.rotate !== undefined || v.filters || v.format,
  { message: 'at least one transformation is required' }
)

export const validateTransformImage = (data) => transformImageSchema.parse(data)
```

## 2. Servicio Sharp — pipeline con validación de crop e idempotencia

```js
import sharp from 'sharp'
import { createHash } from 'node:crypto'

const EXT_BY_FORMAT = { jpeg: '.jpg', png: '.png', webp: '.webp', avif: '.avif', gif: '.gif' }
const MIME_BY_FORMAT = { jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', avif: 'image/avif', gif: 'image/gif' }

export const sharpService = {
  // ...getImageMetadata(buffer) de F002...

  variantIdFor(imageId, transforms) {
    return createHash('sha256')
      .update(imageId + JSON.stringify(transforms))
      .digest('hex')
      .slice(0, 8)
  },

  async transform(buffer, t) {
    let img = sharp(buffer)
    if (t.rotate) img = img.rotate(t.rotate)
    if (t.crop) {
      const meta = await sharp(buffer).metadata()
      const { left, top, width, height } = t.crop
      if (left + width > meta.width || top + height > meta.height) {
        const err = new Error('Crop out of bounds')
        err.status = 400
        throw err
      }
      img = img.extract({ left, top, width, height })
    }
    if (t.resize) {
      img = img.resize({ width: t.resize.width, height: t.resize.height, fit: t.resize.fit ?? 'cover' })
    }
    if (t.filters?.grayscale) img = img.grayscale(true)
    if (t.filters?.sepia) {
      img = img.modulate({ saturation: 0.55 }).tint({ r: 255, g: 200, b: 140 })
    }
    let mimeType, ext
    if (t.format) {
      img = img.toFormat(t.format, t.format === 'jpeg' ? { quality: 85 } : {})
      mimeType = MIME_BY_FORMAT[t.format]
      ext = EXT_BY_FORMAT[t.format]
    }
    const data = await img.toBuffer()
    const info = await sharp(data).metadata()
    return { data, mimeType, ext, size: data.byteLength, width: info.width, height: info.height }
  }
}
```

Nota: `variantIdFor` es determinista ⇒ mismo payload sobre misma imagen reutiliza variante (idempotencia garantizada por contrato).

## 3. Modelo — variantes y logs

Variantes en el campo Json `Image.variants` (sin migraciones extra en v1):

```js
// models/image.model.js (adiciones)
async addVariant({ imageId, variantId, variant }) {
  const image = await this.getById(imageId)
  return prisma.image.update({
    where: { id: imageId },
    data: { variants: { ...(image.variants ?? {}), [variantId]: variant } }
  })
}
```

```js
// models/transform.model.js
import { prisma } from '../db/prisma.js'

export const transformModel = {
  createLog(imageId, operation) {
    return prisma.transformLog.create({ data: { imageId, operation, status: 'pending' } })
  },
  markDone(logId) {
    return prisma.transformLog.update({ where: { id: logId }, data: { status: 'done' } })
  },
  markFailed(logId) {
    return prisma.transformLog.update({ where: { id: logId }, data: { status: 'failed' } })
  }
}
```

## 4. Controller — método `transform`

Flujo: ownership → idempotencia → (cola | síncrono) → persistir variante.

```js
async transform(req, res) {
  const image = await imageModel.getById(req.params.id)
  if (!image || image.userId !== req.user.sub) {
    return res.status(404).json({ error: 'Image not found' })
  }

  const transforms = req.body // validado por middleware Zod
  const variantId = sharpService.variantIdFor(image.id, transforms)

  const existing = image.variants?.[variantId]
  if (existing && !config.queueEnabled) {
    return res.status(201).json(buildVariantResponse(image, variantId, existing))
  }

  if (config.queueEnabled) {
    const log = await transformModel.createLog(image.id, transforms)
    await queueService.publishTransform({
      logId: log.id,
      imageId: image.id,
      storagePath: image.storagePath,
      transforms
    })
    return res.status(202).json({ status: 'pending', transformId: log.id })
  }

  try {
    const buffer = await readFile(path.join(config.uploadsDir, image.storagePath))
    const result = await sharpService.transform(buffer, transforms)
    const relPath = path.join(...image.storagePath.split('/').slice(0, 2), image.id, `${variantId}${result.ext}`)
    await writeFile(path.join(config.uploadsDir, relPath), result.data)

    const variant = {
      path: relPath,
      mimeType: result.mimeType ?? image.mimeType, // fallback al formato original
      size: result.size,
      width: result.width,
      height: result.height,
      transforms
    }
    await imageModel.addVariant({ imageId: image.id, variantId, variant })
    return res.status(201).json(buildVariantResponse(image, variantId, variant))
  } catch (err) {
    if (err.status === 400) return res.status(400).json({ error: err.message })
    throw err
  }
}
```

Helper compartido:

```js
function buildVariantResponse(image, variantId, v) {
  return {
    imageId: image.id,
    variantId,
    url: `/api/v1/images/${image.id}/variants/${variantId}`,
    mimeType: v.mimeType,
    size: v.size,
    width: v.width,
    height: v.height,
    appliedTransforms: Object.keys(v.transforms)
  }
}
```

## 5. Servir la variante

```js
async getVariantFile(req, res) {
  const image = await imageModel.getById(req.params.id)
  if (!image || image.userId !== req.user.sub) {
    return res.status(404).json({ error: 'Image not found' })
  }
  const v = image.variants?.[req.params.variantId]
  if (!v) return res.status(404).json({ error: 'Variant not found' })
  res.setHeader('Content-Type', v.mimeType)
  return res.sendFile(path.join(config.uploadsDir, v.path))
}
```

Rutas:

```js
router.post('/images/:id/transform', verifyToken, validate(transformImageSchema), imageController.transform)
router.get('/images/:id/variants/:variantId', verifyToken, imageController.getVariantFile)
```

## 6. Cola RabbitMQ (feature-flag `queueEnabled`)

```js
// services/queue.service.js
import amqplib from 'amqplib'
import { config } from '../config.js'

const QUEUE = 'image.transforms'

export const queueService = {
  async publishTransform(payload) {
    const conn = await amqplib.connect(config.rabbitUrl)
    try {
      const ch = await conn.createChannel()
      await ch.assertQueue(QUEUE, { durable: true })
      ch.sendToQueue(QUEUE, Buffer.from(JSON.stringify(payload)), { persistent: true })
    } finally {
      await conn.close()
    }
  },

  async consume(onMessage) {
    const conn = await amqplib.connect(config.rabbitUrl)
    const ch = await conn.createChannel()
    await ch.assertQueue(QUEUE, { durable: true })
    ch.prefetch(1)
    ch.consume(QUEUE, async (msg) => {
      try {
        await onMessage(JSON.parse(msg.content.toString()))
        ch.ack(msg)
      } catch (err) {
        ch.nack(msg, false, false) // a DLQ en iteraciones futuras
        throw err
      }
    })
  }
}
```

Worker (`backend/workers/transform.worker.js`, proceso separado `node workers/transform.worker.js`):

```js
await queueService.consume(async ({ logId, imageId, storagePath, transforms }) => {
  const image = await imageModel.getById(imageId)
  const variantId = sharpService.variantIdFor(imageId, transforms)
  const buffer = await readFile(path.join(config.uploadsDir, storagePath))
  const result = await sharpService.transform(buffer, transforms)
  // ... escribir archivo + addVariant (mismo código que el modo síncrono) ...
  await transformModel.markDone(logId)
})
```

En fallo del worker: envolver en try/catch interno y llamar `markFailed(logId)` en vez de re-lanzar.

## 7. Tests e2e (modo síncrono)

- Fixture 64×64 PNG subida vía endpoint real de F002.
- Resize+webp ⇒ 201, dimensiones correctas, mime `image/webp`.
- Mismo request repetido ⇒ misma variantId.
- Crop out-of-bounds ⇒ 400.
- Rotate 45 ⇒ 400 (schema).
- `{}` vacío ⇒ 400.
- Imagen ajena ⇒ 404.
