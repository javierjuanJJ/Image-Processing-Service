import { z } from 'zod'
import { config } from '../config.js'

export const imageSchema = z.object({
  filename: z
    .string()
    .min(1)
    .max(255)
    .transform(s => s.replace(/[^\w.\- ]/g, '').trim())
    .refine(s => s.length > 0, { message: 'filename must contain visible characters' }),
  mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif']),
  size: z.number().int().positive()
})

export const imageListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(config.pagination.maxLimit).default(config.pagination.defaultLimit)
})

const resizeSchema = z
  .object({
    width: z.number().int().min(1).max(8000).optional(),
    height: z.number().int().min(1).max(8000).optional(),
    fit: z.enum(['cover', 'contain', 'fill', 'inside', 'outside']).default('cover')
  })
  .refine(v => v.width != null || v.height != null, { message: 'resize requires width or height' })

export const transformImageSchema = z
  .object({
    resize: resizeSchema.optional(),
    crop: z
      .object({
        left: z.number().int().min(0),
        top: z.number().int().min(0),
        width: z.number().int().min(1),
        height: z.number().int().min(1)
      })
      .optional(),
    rotate: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]).optional(),
    filters: z
      .object({
        grayscale: z.boolean().optional(),
        sepia: z.boolean().optional()
      })
      .optional(),
    format: z.enum(['jpeg', 'png', 'webp', 'avif', 'gif']).optional()
  })
  .refine(
    v => v.resize || v.crop || v.rotate !== undefined || v.filters || v.format,
    { message: 'at least one transformation is required' }
  )

export const validateImage = (data) => imageSchema.parse(data)
export const validatePartialImage = (data) => imageSchema.partial().parse(data)
export const validateTransformImage = (data) => transformImageSchema.parse(data)
export const validatePartialTransformImage = (data) => transformImageSchema.partial().parse(data)
