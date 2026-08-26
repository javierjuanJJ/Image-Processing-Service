import jwt from 'jsonwebtoken'
import bcrypt from 'bcryptjs'
import { userModel } from '../models/user.model.js'
import { config } from '../config.js'

export const authController = {
  async register(req, res) {
    const { email, password } = req.body
    const exists = await userModel.getByEmail(email)
    if (exists) return res.status(409).json({ error: 'Email already registered' })

    const user = await userModel.create({ email, password })
    return res.status(201).json({ id: user.id, email: user.email })
  },

  async login(req, res) {
    const { email, password } = req.body
    const user = await userModel.getByEmail(email)
    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ error: 'Invalid credentials' })
    }
    const token = jwt.sign({ sub: user.id, email: user.email }, config.jwtSecret, {
      expiresIn: config.jwtExpiresIn
    })
    return res.status(200).json({ token, expiresIn: config.jwtExpiresIn })
  }
}
