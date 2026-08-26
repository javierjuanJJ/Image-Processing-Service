import multer from 'multer'
import { config } from '../config.js'

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.upload.maxFileSizeMB * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!config.upload.allowedMimeTypes.includes(file.mimetype)) {
      const err = new Error('Unsupported image type')
      err.mime = file.mimetype
      return cb(err)
    }
    cb(null, true)
  }
})

export const uploadSingle = upload.single('image')
