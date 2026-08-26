import multer from 'multer'
import { config } from '../config.js'

export const errorHandler = (err, req, res, next) => {
  if (err?.code === 'P2002') {
    return res.status(409).json({ error: 'Email already registered' })
  }

  if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({
      error: 'File too large',
      details: [`${config.upload.maxFileSizeMB}MB max`]
    })
  }

  if (err?.message === 'Unsupported image type') {
    return res.status(400).json({
      error: err.message,
      details: err.mime ? [err.mime] : undefined
    })
  }

  if (err?.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Malformed JSON body' })
  }

  if (err?.status === 400) {
    return res.status(400).json({ error: err.message })
  }

  console.error(err)
  return res.status(500).json({ error: 'Internal Server Error' })
}
