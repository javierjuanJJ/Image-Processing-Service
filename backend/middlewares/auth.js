import jwt from 'jsonwebtoken'
import { config } from '../config.js'

export const verifyToken = (req, res, next) => {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  try {
    const payload = jwt.verify(header.slice(7), config.jwtSecret)
    req.user = { sub: payload.sub, email: payload.email }
    next()
  } catch {
    return res.status(401).json({ error: 'Unauthorized' })
  }
}
