# Plan Técnico — Feature 002 Carga de Imágenes

## Archivos a crear/modificar

| Archivo | Acción | Responsabilidad |
|---|---|---|
| `backend/middlewares/upload.js` | crear | Multer memoryStorage + límites |
| `backend/schemas/image.schema.js` | crear | Zod: upload (file meta) y query de listado (se usa en F005) |
| `backend/models/image.model.js` | crear | CRUD Prisma sobre `images` |
| `backend/services/sharp.service.js` | crear | `getImageMetadata(buffer)` (y base para F003) |
| `backend/controllers/image.controller.js` | crear/extend | método `create` |
| `backend/routes/image.routes.js` | crear | POST `/images` con middlewares |
| `routes/index.js` | modificar | montar image routes |
| `config.js` | modificar | `upload.*`, ruta `uploadsDir` |

## 1. Middleware multer (`middlewares/upload.js`)

```js
import multer from 'multer'
import { config } from '../config.js'

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.upload.maxFileSizeMB * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!config.upload.allowedMimeTypes.includes(file.mimetype)) {
      return cb(new Error('Unsupported image type'))
    }
    cb(null, true)
  }
})

export const uploadSingle = upload.single('image')
```

El error de multer (`LIMIT_FILE_SIZE`) se traduce en `error-handler.js`:

```js
if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
  return res.status(413).json({ error: 'File too large', details: [`${config.upload.maxFileSizeMB}MB max`] })
}
if (err.message === 'Unsupported image type') {
  return res.status(400).json({ error: err.message })
}
```

## 2. Schemas Zod (`schemas/image.schema.js`)

```js
import { z } from 'zod'

export const imageSchema = z.object({
  filename: z.string().min(1).max(255)
    .transform(s => s.replace(/[^\w.\- ]/g, '').trim()),   // sanitización
  mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif']),
  size: z.number().int().positive()
})

export const imageListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(config.pagination.maxLimit).default(config.pagination.defaultLimit)
})

export const validateImage = (data) => imageSchema.parse(data)
export const validatePartialImage = (data) => imageSchema.partial().parse(data)
```

Nota: el mime del schema se valida contra lo que **sharp detecta** (ver §3), no contra `file.mimetype` del cliente (que solo es una pista inicial para rechazar temprano).

## 3. Servicio sharp (`services/sharp.service.js`)

```js
import sharp from 'sharp'

const MIME_BY_FORMAT = { jpeg: 'image/jpeg', jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', avif: 'image/avif' }

export const sharpService = {
  async getImageMetadata(buffer) {
    const metadata = await sharp(buffer).metadata()
    const format = MIME_BY_FORMAT[metadata.format]
    if (!format) throw new Error('Invalid image content')
    return {
      mimeType: format,
      width: metadata.width,
      height: metadata.height,
      size: buffer.byteLength,
      ext: metadata.format === 'jpg' ? '.jpg' : `.${metadata.format}`
    }
  }
}
```

## 4. Modelo (`models/image.model.js`)

```js
import { prisma } from '../db/prisma.js'

export const imageModel = {
  create({ userId, filename, mimeType, size, width, height, storagePath }) {
    return prisma.image.create({
      data: { userId, filename, mimeType, size, width, height, storagePath }
    })
  },

  getById(id) {
    return prisma.image.findUnique({ where: { id } })
  },

  list({ userId, page = 1, limit = 10 }) {
    return prisma.$transaction([
      prisma.image.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit
      }),
      prisma.image.count({ where: { userId } })
    ])
  }
}
```

## 5. Controller — método `create`

Flujo: file presente → metadatos sharp → escribir binario → insertar en BD → responder.

```js
import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { imageModel } from '../models/image.model.js'
import { sharpService } from '../services/sharp.service.js'
import { validateImage } from '../schemas/image.schema.js'
import { config } from '../config.js'

export const imageController = {
  async create(req, res) {
    if (!req.file) return res.status(400).json({ error: 'No image file provided' })

    let meta
    try {
      meta = await sharpService.getImageMetadata(req.file.buffer) // valida contenido REAL
    } catch {
      return res.status(400).json({ error: 'Invalid image content' })
    }

    // Validar/sanitizar nombre visible con Zod (fallback al original)
    const [{ filename }] = (() => {
      try { return [validateImage({ filename: req.body.filename ?? req.file.originalname, mimeType: meta.mimeType, size: meta.size })] }
      catch { return [null] }
    })() ?? []

    const id = randomUUID()
    const now = new Date()
    const relPath = path.join(String(now.getFullYear()), String(now.getMonth() + 1).padStart(2, '0'), `${id}${meta.ext}`)
    const absPath = path.join(config.uploadsDir, relPath)

    await mkdir(path.dirname(absPath), { recursive: true })
    await writeFile(absPath, req.file.buffer)

    const image = await imageModel.create({
      userId: req.user.sub,
      filename: filename ?? req.file.originalname.slice(0, 255),
      mimeType: meta.mimeType,
      size: meta.size,
      width: meta.width,
      height: meta.height,
      storagePath: relPath
    })

    return res.status(201).json({
      id: image.id,
      filename: image.filename,
      mimeType: image.mimeType,
      size: image.size,
      width: image.width,
      height: image.height,
      url: `/api/v1/images/${image.id}/file`,
      createdAt: image.createdAt
    })
  }
}
```

Detalle: si `writeFile` o `create` fallan, capturar en el catch del controller/error-handler y borrar el archivo escrito (evitar huérfanos). Envolver la escritura+BD en try/catch con cleanup:

```js
try { /* write + db */ } catch (err) {
  await unlink(absPath).catch(() => {})
  throw err
}
```

## 6. Rutas

```js
// backend/routes/image.routes.js
import { Router } from 'express'
import { verifyToken } from '../middlewares/auth.js'
import { uploadSingle } from '../middlewares/upload.js'
import { imageController } from '../controllers/image.controller.js'

const router = Router()

router.post('/images', verifyToken, uploadSingle, imageController.create)

export default router
```

Montaje en `routes/index.js`: `router.use('/api/v1', imageRoutes)`.

## 7. Config añadida

```js
uploadsDir: process.env.UPLOADS_DIR ?? 'uploads',
upload: { maxFileSizeMB: 10, allowedMimeTypes: [...] }
```

Añadir `uploads/` a `.gitignore`.

## 8. Tests e2e

Fixture generada en runtime (sin binarios en repo):

```js
const pngBuffer = await sharp({ create: { width: 32, height: 32, channels: 3, background: '#ff0000' } }).png().toBuffer()
```

Escenarios:
1. Upload válido ⇒ 201 + shape + `width===32 && height===32`.
2. Sin token ⇒ 401.
3. Sin file ⇒ 400.
4. Buffer corrupto (`Buffer.from('not-an-image')` con mimetype image/png forzado) ⇒ 400 `Invalid image content`.
5. Cleanup `after`: borrar carpeta uploads de test.
