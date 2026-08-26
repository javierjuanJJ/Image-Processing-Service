import { prisma } from '../db/prisma.js'

export const transformModel = {
  createLog(imageId, operation) {
    return prisma.transformLog.create({
      data: { imageId, operation, status: 'pending' }
    })
  },

  markDone(logId) {
    return prisma.transformLog.update({ where: { id: logId }, data: { status: 'done' } })
  },

  markFailed(logId) {
    return prisma.transformLog.update({ where: { id: logId }, data: { status: 'failed' } })
  }
}
