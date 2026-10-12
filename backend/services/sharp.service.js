import sharp from 'sharp'
import { createHash } from 'node:crypto'
import { storageService } from './storage.service.js'

const { joinKey } = storageService

export const EXT_BY_FORMAT = { jpeg: '.jpg', png: '.png', webp: '.webp', avif: '.avif', gif: '.gif' }
export const MIME_BY_FORMAT = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  avif: 'image/avif',
  gif: 'image/gif'
}

const MIME_BY_SHARP_FORMAT = { ...MIME_BY_FORMAT, jpg: 'image/jpeg' }

export const sharpService = {
  async getImageMetadata(buffer) {
    const metadata = await sharp(buffer).metadata()
    const mimeType = MIME_BY_SHARP_FORMAT[metadata.format]
    if (!mimeType) throw new Error('Invalid image content')
    return {
      mimeType,
      width: metadata.width,
      height: metadata.height,
      size: buffer.byteLength,
      ext: metadata.format === 'jpg' ? '.jpg' : `.${metadata.format}`
    }
  },

  variantIdFor(imageId, transforms) {
    return createHash('sha256')
      .update(imageId + JSON.stringify(transforms))
      .digest('hex')
      .slice(0, 8)
  },

  async transform(buffer, t) {
    let img = sharp(buffer)
    if (t.rotate && t.rotate !== 0) img = img.rotate(t.rotate)
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
      img = img.resize({
        width: t.resize.width,
        height: t.resize.height,
        fit: t.resize.fit ?? 'cover',
        withoutEnlargement: false
      })
    }
    if (t.filters?.grayscale) img = img.grayscale(true)
    if (t.filters?.sepia) {
      img = img.modulate({ saturation: 0.55 }).tint({ r: 255, g: 200, b: 140 })
    }
    if (t.format) {
      img = img.toFormat(t.format, t.format === 'jpeg' ? { quality: 85 } : {})
    }

    const data = await img.toBuffer()
    const info = await sharp(data).metadata()
    return {
      data,
      mimeType: t.format ? MIME_BY_FORMAT[t.format] : undefined,
      ext: t.format ? EXT_BY_FORMAT[t.format] : undefined,
      size: data.byteLength,
      width: info.width,
      height: info.height
    }
  },

  async buildVariant(image, transforms) {
    const buffer = await storageService.download(image.storagePath)
    const result = await sharpService.transform(buffer, transforms)

    const relPath = joinKey(
      ...image.storagePath.split('/').slice(0, 2),
      image.id,
      `${sharpService.variantIdFor(image.id, transforms)}${result.ext ?? ''}`
    )
    await storageService.upload(relPath, result.data, result.mimeType ?? image.mimeType)

    return {
      path: relPath,
      mimeType: result.mimeType ?? image.mimeType,
      size: result.size,
      width: result.width,
      height: result.height,
      transforms
    }
  }
}
