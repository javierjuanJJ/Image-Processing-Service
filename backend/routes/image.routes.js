import { Router } from 'express'
import { verifyToken } from '../middlewares/auth.js'
import { validate } from '../middlewares/validate.js'
import { uploadSingle } from '../middlewares/upload.js'
import { imageListQuerySchema, transformImageSchema } from '../schemas/image.schema.js'
import { imageController } from '../controllers/image.controller.js'

const router = Router()

router.post('/images', verifyToken, uploadSingle, imageController.create)
router.get('/images', verifyToken, validate(imageListQuerySchema, 'query'), imageController.getAll)
router.get('/images/:id', verifyToken, imageController.getId)
router.get('/images/:id/file', verifyToken, imageController.getFile)
router.post('/images/:id/transform', verifyToken, validate(transformImageSchema), imageController.transform)
router.get('/images/:id/variants/:variantId', verifyToken, imageController.getVariantFile)

export default router
