# Tech Stack y Límites Duros (Constitución Técnica)

Este documento es **vinculante**. Toda feature debe respetar estas decisiones. Cambiar algo de aquí requiere actualizar este archivo primero.

## 1. Stack tecnológico obligatorio

| Capa | Tecnología | Versión | Notas |
|---|---|---|---|
| Runtime | Node.js | ≥ 22 | ES Modules nativos (`"type": "module"` en `package.json`). |
| Framework HTTP | Express | 5.x | `app.js` instancia Express; servidor HTTP solo si `NODE_ENV !== 'test'`. |
| Lenguaje | JavaScript estricto (ESM) | — | `import/export`, `"use strict"` implícito en ESM. Sin CommonJS. |
| Validación | Zod | 3.x / 4.x | Única fuente de verdad de contratos. |
| ORM | Prisma | ≥ 5 | PostgreSQL como único proveedor soportado. |
| Procesamiento de imágenes | Sharp | 0.33+ | resize, crop (extract), rotate, format, modulate/tint (grayscale/sepia). |
| Auth | jsonwebtoken | 9.x | JWT HS256, payload mínimo `{ sub, email }`. |
| Cola (opcional) | amqplib + RabbitMQ | — | Solo para transformaciones pesadas; feature-flag vía env `QUEUE_ENABLED`. |
| Docs API | Swagger UI + OpenAPI 3.1 | — | Spec servida desde `/docs`; spec fuente versionada en repo. |
| Tests | `node:test` + `node:assert` | nativos | Sin Jest/Mocha/Vitest. E2E con servidor real en puerto dedicado. |

**Prohibido**: TypeScript compilado, Sequelize/Mongoose/Knex, Multer alternativos no acordados (`multer` es el parser multipart), librerías de imágenes distintas a `sharp`.

## 2. Estructura de carpetas (inmutable)

```
backend/
├── app.js                  # Instancia Express, middlewares globales, rutas, listen condicional
├── config.js               # Puerto, JWT_SECRET, límites de paginación, whitelist CORS
├── db/
│   └── prisma.js           # Cliente Prisma singleton exportado
├── schemas/                # Zod: validación de entrada
│   ├── auth.schema.js      # validateRegister, validateLogin (+ variantes Partial)
│   ├── image.schema.js     # validateCreateImage, validateTransformImage, validateListQuery
│   └── ...
├── models/                 # Acceso a datos: única capa que usa Prisma Client
│   ├── user.model.js       # create, getByEmail, getById
│   └── image.model.js      # create, getById, list (paginado), update, delete
├── controllers/            # Métodos estáticos async; orquestan schema→model→respuesta
│   ├── auth.controller.js  # register, login
│   └── image.controller.js # getAll, getId, create, update, partialUpdate, delete
├── routes/                 # Router() por módulo + middlewares de validación/auth
│   ├── auth.routes.js
│   ├── image.routes.js
│   └── index.js            # monta /api/v1/*
├── middlewares/
│   ├── cors.js             # Whitelist de orígenes desde config
│   ├── auth.js             # verifyToken: Bearer JWT → req.user
│   ├── validate.js         # factory validate(schema) → 400 con issues
│   ├── upload.js           # multer memoryStorage → req.file
│   └── error-handler.js    # último middleware: normaliza errores a JSON
├── services/               # Lógica pura reutilizable
│   ├── sharp.service.js    # transform(buffer, options) → buffer
│   └── queue.service.js    # publish/consume RabbitMQ (si QUEUE_ENABLED)
├── app.test.js             # Suite e2e node:test (before/after levantan servidor)
└── prisma/
    ├── schema.prisma
    └── migrations/
spec/
├── constitution/
└── features/NNN-nombre-feature/{spec.md, plan.md, tasks.md}
```

### Reglas de dependencias (import direction)

```
routes → controllers → models → prisma
routes → middlewares → (config)
controllers/services → schemas (solo para tipos/parseo interno)
NUNCA: models → controllers | prisma fuera de models/db
```

## 3. Modelo de dominio (Prisma)

```prisma
// backend/prisma/schema.prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id        String   @id @default(uuid())
  email     String   @unique
  password  String   // hash bcrypt/argon2, NUNCA texto plano
  images    Image[]
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@map("users")
}

model Image {
  id          String   @id @default(uuid())
  userId      String
  user        User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  filename    String   // nombre original sanitizado
  mimeType    String   // image/png, image/jpeg, image/webp...
  size        Int      // bytes del original
  width       Int?
  height      Int?
  storagePath String   // ruta relativa en disco/S3 del original
  variants    Json?    // { "thumb": "path", "webp": "path", ... }
  transforms  TransformLog[]
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@index([userId, createdAt(sort: Desc)])
  @@map("images")
}

// Auditoría opcional de transformaciones (Feature 003)
model TransformLog {
  id        String   @id @default(cuid())
  imageId   String
  image     Image    @relation(fields: [imageId], references: [id], onDelete: Cascade)
  operation Json     // { op: "resize", args: { width: 300 } }
  status    String   @default("pending") // pending | done | failed
  createdAt DateTime @default(now())

  @@index([imageId])
  @@map("transform_logs")
}
```

Reglas del modelo:
- Toda query de `Image` **debe filtrar por `userId`** salvo operaciones internas.
- Índice compuesto `[userId, createdAt DESC]` obligatorio para el listado paginado.
- Los binarios viven fuera de la BD (disco: `uploads/`); la BD guarda metadatos y rutas.

## 4. Convenciones de código

- **Schemas Zod**: exportan `validate<Entity>` (objeto completo) y `validatePartial<Entity>` (`entity.partial()`). Ejemplo canónico:

```js
// backend/schemas/image.schema.js
import { z } from 'zod'

export const imageSchema = z.object({
  filename: z.string().min(1).max(255),
  mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif']),
  size: z.number().int().positive()
})

export const validateImage = (data) => imageSchema.parse(data)
export const validatePartialImage = (data) => imageSchema.partial().parse(data)
```

- **Controllers**: métodos estáticos agrupados en objeto exportado, siempre `async`, SIEMPRE devuelven respuesta JSON con status explícito:

```js
export const imageController = {
  async getAll(req, res) {
    const { page = 1, limit = 10 } = req.query
    const result = await imageModel.list({ userId: req.user.sub, page: Number(page), limit: Number(limit) })
    return res.status(200).json(result)
  }
}
```

- **Routes**: una línea por endpoint, middleware de validación antes del controller:

```js
router.post('/images', verifyToken, upload.single('image'), validateImageUpload, imageController.create)
```

- Errores esperados ⇒ status 4xx con `{ error: string, details?: unknown }`. Nunca filtrar stack traces al cliente.
- Variables de entorno leídas SOLO en `config.js`.
- Sin comentarios explicando lo obvio; JSDoc solo en APIs públicas de módulos.

## 5. Convenciones de tests (`backend/app.test.js`)

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'

test.before(async () => { server = app.listen(TEST_PORT) })
test.after(async () => { await new Promise(r => server.close(r)) })

test('POST /api/v1/register returns 201', async () => { ... })
```

- Puerto de test: `config.port + 1` o `0` (efímero).
- Cada suite limpia su estado (BD de test o fixtures temporales).
- Se prueba contrato HTTP completo: status, shape del body y headers relevantes.

## 6. Configuración (`config.js`) — valores por defecto

```js
export const config = {
  port: Number(process.env.PORT ?? 3000),
  jwtSecret: process.env.JWT_SECRET,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '1h',
  corsOrigins: (process.env.CORS_ORIGINS ?? 'http://localhost:5173').split(','),
  pagination: { defaultLimit: 10, maxLimit: 50 },
  upload: { maxFileSizeMB: 10, allowedMimeTypes: ['image/jpeg','image/png','image/webp','image/gif','image/avif'] },
  queueEnabled: process.env.QUEUE_ENABLED === 'true',
  rabbitUrl: process.env.RABBIT_URL ?? 'amqp://localhost'
}
```
