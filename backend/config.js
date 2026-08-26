const failFast = process.env.NODE_ENV !== 'test'

if (!process.env.JWT_SECRET && failFast) {
  throw new Error('Missing required environment variable JWT_SECRET')
}
if (!process.env.DATABASE_URL && failFast) {
  throw new Error('Missing required environment variable DATABASE_URL')
}

export const config = {
  env: process.env.NODE_ENV ?? 'development',
  port: Number(process.env.PORT ?? 3000),
  jwtSecret: process.env.JWT_SECRET,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '1h',
  corsOrigins: (process.env.CORS_ORIGINS ?? 'http://localhost:5173').split(','),
  pagination: { defaultLimit: 10, maxLimit: 50 },
  upload: {
    maxFileSizeMB: 10,
    allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif']
  },
  uploadsDir: process.env.UPLOADS_DIR ?? 'uploads',
  queueEnabled: process.env.QUEUE_ENABLED === 'true',
  rabbitUrl: process.env.RABBIT_URL ?? 'amqp://localhost'
}
