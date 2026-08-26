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
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * limit,
        take: limit
      }),
      prisma.image.count({ where: { userId } })
    ])
  },

  async addVariant({ imageId, variantId, variant }) {
    const image = await this.getById(imageId)
    return prisma.image.update({
      where: { id: imageId },
      data: { variants: { ...(image.variants ?? {}), [variantId]: variant } }
    })
  }
}
