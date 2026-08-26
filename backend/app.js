import express from 'express'
import swaggerUi from 'swagger-ui-express'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import routes from './routes/index.js'
import { corsMiddleware } from './middlewares/cors.js'
import { errorHandler } from './middlewares/error-handler.js'
import { config } from './config.js'

const openapiSpec = JSON.parse(
  readFileSync(fileURLToPath(new URL('./docs/openapi.json', import.meta.url)), 'utf8')
)

const app = express()

app.use(corsMiddleware)
app.use(express.json({ limit: '1mb' }))
app.use('/docs', swaggerUi.serve, swaggerUi.setup(openapiSpec))
app.use(routes)
app.use(errorHandler)

if (config.env !== 'test') {
  app.listen(config.port, () => {
    console.log(`image-processing-service listening on :${config.port} (docs at /docs)`)
  })
}

export default app
