import { Router } from 'express'
import { validate } from '../middlewares/validate.js'
import { registerSchema, loginSchema } from '../schemas/auth.schema.js'
import { authController } from '../controllers/auth.controller.js'

const router = Router()

router.post('/register', validate(registerSchema), authController.register)
router.post('/login', validate(loginSchema), authController.login)

export default router
