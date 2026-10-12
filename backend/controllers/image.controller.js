import { randomUUID } from 'node:crypto'
import { imageModel } from '../models/image.model.js'
import { sharpService } from '../services/sharp.service.js'
import { storageService } from '../services/storage.service.js'
import { queueService } from '../services/queue.service.js'
import { transformModel } from '../models/transform.model.js'
import { validateImage } from '../schemas/image.schema.js'
import { config } from '../config.js'

const { joinKey } = storageService

const sanitizeFilename = (name) => {
  const s = String(name ?? '')
    .replace(/[^\w.\- ]/g, '')
    .trim()
    .slice(0, 255)
  return s.length > 0 ? s : 'image'
}

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

export const imageController = {
  async create(req, res) {
    if (!req.file) return res.status(400).json({ error: 'No image file provided' })

    let meta
    try {
      meta = await sharpService.getImageMetadata(req.file.buffer)
    } catch {
      return res.status(400).json({ error: 'Invalid image content' })
    }

    let filename
    try {
      const parsed = validateImage({
        filename: req.body.filename ?? req.file.originalname,
        mimeType: meta.mimeType,
        size: meta.size
      })
      filename = parsed.filename
    } catch {
      filename = sanitizeFilename(req.file.originalname)
    }

    const id = randomUUID()
    const now = new Date()
    const relPath = joinKey(
      String(now.getFullYear()),
      String(now.getMonth() + 1).padStart(2, '0'),
      `${id}${meta.ext}`
    )

    try {
      await storageService.upload(relPath, req.file.buffer, meta.mimeType)

      const image = await imageModel.create({
        userId: req.user.sub,
        filename,
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
    } catch (err) {
      await storageService.delete(relPath).catch(() => {})
      throw err
    }
  },

  async getAll(req, res) {
    const { page, limit } = req.query
    const [items, total] = await imageModel.list({ userId: req.user.sub, page, limit })

    return res.status(200).json({
      data: items.map(image => ({
        id: image.id,
        filename: image.filename,
        mimeType: image.mimeType,
        size: image.size,
        width: image.width,
        height: image.height,
        url: `/api/v1/images/${image.id}/file`,
        createdAt: image.createdAt
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    })
  },

  async getId(req, res) {
    const image = await imageModel.getById(req.params.id)
    if (!image || image.userId !== req.user.sub) {
      return res.status(404).json({ error: 'Image not found' })
    }

    const variants = Object.fromEntries(
      Object.entries(image.variants ?? {}).map(([variantId, v]) => [
        variantId,
        {
          url: `/api/v1/images/${image.id}/variants/${variantId}`,
          mimeType: v.mimeType,
          size: v.size,
          width: v.width,
          height: v.height
        }
      ])
    )

    return res.status(200).json({
      id: image.id,
      filename: image.filename,
      mimeType: image.mimeType,
      size: image.size,
      width: image.width,
      height: image.height,
      url: `/api/v1/images/${image.id}/file`,
      variants,
      createdAt: image.createdAt
    })
  },

  async getFile(req, res) {
    const image = await imageModel.getById(req.params.id)
    if (!image || image.userId !== req.user.sub) {
      return res.status(404).json({ error: 'Image not found' })
    }

    let buffer
    try {
      buffer = await storageService.download(image.storagePath)
    } catch {
      return res.status(404).json({ error: 'File missing' })
    }

    res.setHeader('Content-Type', image.mimeType)
    res.setHeader('Content-Length', buffer.byteLength)
    res.setHeader('Cache-Control', 'private, max-age=3600')
    if (req.query.download === '1') {
      res.setHeader('Content-Disposition', `attachment; filename="${image.filename}"`)
    }
    return res.send(buffer)
  },

  async getVariantFile(req, res) {
    const image = await imageModel.getById(req.params.id)
    if (!image || image.userId !== req.user.sub) {
      return res.status(404).json({ error: 'Image not found' })
    }

    const v = image.variants?.[req.params.variantId]
    if (!v) return res.status(404).json({ error: 'Variant not found' })

    let buffer
    try {
      buffer = await storageService.download(v.path)
    } catch {
      return res.status(404).json({ error: 'File missing' })
    }

    res.setHeader('Content-Type', v.mimeType)
    res.setHeader('Content-Length', buffer.byteLength)
    res.setHeader('Cache-Control', 'private, max-age=3600')
    if (req.query.download === '1') {
      res.setHeader('Content-Disposition', `attachment; filename="${image.filename}"`)
    }
    return res.send(buffer)
  },

  async transform(req, res) {
    const image = await imageModel.getById(req.params.id)
    if (!image || image.userId !== req.user.sub) {
      return res.status(404).json({ error: 'Image not found' })
    }

    const transforms = req.body
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

    let variant
    try {
      variant = await sharpService.buildVariant(image, transforms)
    } catch (err) {
      if (err.status === 400) return res.status(400).json({ error: err.message })
      throw err
    }

    try {
      await imageModel.addVariant({ imageId: image.id, variantId, variant })
    } catch (err) {
      await storageService.delete(variant.path).catch(() => {})
      throw err
    }

    return res.status(201).json(buildVariantResponse(image, variantId, variant))
  }
}
