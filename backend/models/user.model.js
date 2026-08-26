import bcrypt from 'bcryptjs'
import { prisma } from '../db/prisma.js'

export const userModel = {
  async create({ email, password }) {
    const hash = await bcrypt.hash(password, 10)
    return prisma.user.create({ data: { email, password: hash } })
  },

  getByEmail(email) {
    return prisma.user.findUnique({ where: { email } })
  },

  getById(id) {
    return prisma.user.findUnique({ where: { id } })
  }
}
