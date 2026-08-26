import { Router } from 'express'
import authRoutes from './auth.routes.js'
import imageRoutes from './image.routes.js'

const router = Router()
router.use('/api/v1', authRoutes)
router.use('/api/v1', imageRoutes)

export default router
