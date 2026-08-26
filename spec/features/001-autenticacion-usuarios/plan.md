# Plan Técnico — Feature 001 Autenticación

## Archivos a crear/modificar

| Archivo | Acción | Responsabilidad |
|---|---|---|
| `backend/schemas/auth.schema.js` | crear | Schemas Zod de register/login |
| `backend/models/user.model.js` | crear | Acceso a datos `users` vía Prisma |
| `backend/controllers/auth.controller.js` | crear | `register`, `login` |
| `backend/routes/auth.routes.js` + `routes/index.js` | crear | Montaje bajo `/api/v1` |
| `backend/middlewares/auth.js` | crear | `verifyToken` JWT |
| `backend/middlewares/validate.js` | crear | Factory genérica de validación Zod |
| `backend/config.js` | crear | `jwtSecret`, `jwtExpiresIn` |
| `backend/db/prisma.js` | crear | Cliente Prisma singleton |
| `prisma/schema.prisma` | crear | Modelo `User` (ver constitution) |
| `app.js` | crear | Express + json + cors + rutas |

## 1. Schemas Zod (`schemas/auth.schema.js`)

```js
import { z } from 'zod'

export const registerSchema = z.object({
  email: z.string().email().toLowerCase(),
  password: z.string().min(8, 'password must be at least 8 characters')
})

export const loginSchema = z.object({
  email: z.string().email().toLowerCase(),
  password: z.string().min(1)
})

export const validateRegister = (data) => registerSchema.parse(data)
export const validatePartialRegister = (data) => registerSchema.partial().parse(data)
export const validateLogin = (data) => loginSchema.parse(data)
export const validatePartialLogin = (data) => loginSchema.partial().parse(data)
```

## 2. Middleware de validación genérico (`middlewares/validate.js`)

Patrón reutilizado por TODAS las features:

```js
export const validate = (schema, source = 'body') => (req, res, next) => {
  try {
    req[source] = schema.parse(req[source])
    next()
  } catch (err) {
    return res.status(400).json({
      error: 'Invalid request',
      details: err.issues?.map(i => ({ path: i.path, message: i.message }))
    })
  }
}
```

## 3. Middleware JWT (`middlewares/auth.js`)

```js
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
```

## 4. Modelo (`models/user.model.js`) — única capa que toca Prisma

```js
import bcrypt from 'bcrypt'
import { prisma } from '../db/prisma.js'

export const userModel = {
  async create({ email, password }) {
    const hash = await bcrypt.hash(password, 10)
    return prisma.user.create({ data: { email, password: hash } })
  },
  getByEmail(email) {
    return prisma.user.findUnique({ where: { email } })
  },
  getById(id) {
    return prisma.user.findUnique({ where: { id } })
  }
}
```

Nota: el email ya llega normalizado desde el schema Zod.

## 5. Controller (`controllers/auth.controller.js`)

Métodos estáticos async; delegan en modelo y responden JSON con status explícito:

```js
import jwt from 'jsonwebtoken'
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
```

Dependencia nueva: `bcrypt` (o `bcryptjs` si se prefiere evitar binarios nativos).

## 6. Rutas (`routes/auth.routes.js` y `routes/index.js`)

```js
// routes/auth.routes.js
import { Router } from 'express'
import { validate } from '../middlewares/validate.js'
import { validateLogin, validatePartialLogin, validateRegister, validatePartialRegister } from '../schemas/auth.schema.js'

const router = Router()

router.post('/register',
  validate(registerSchema),
  authController.register
)

router.post('/login',
  validate(loginSchema),
  authController.login
)

export default router
```

> Ajuste: usar los exports `validateRegister`/`validateLogin` directamente como middlewares curried o la factory `validate(schema)` — elegir UN estilo y mantenerlo en todo el proyecto. Decisión v1: **factory `validate(schema)`**.

```js
// routes/index.js
import { Router } from 'express'
import authRoutes from './auth.routes.js'
import imageRoutes from './image.routes.js'

const router = Router()
router.use('/api/v1', authRoutes)
router.use('/api/v1', imageRoutes) // se añade en Feature 002

export default router
```

## 7. `config.js` y `db/prisma.js`

```js
// db/prisma.js — singleton obligatorio para evitar múltiples instancias en tests
import { PrismaClient } from '@prisma/client'
export const prisma = new PrismaClient()
```

`JWT_SECRET` debe fallar rápido: en `config.js`, si falta y `NODE_ENV !== 'test'`, lanzar error al arrancar.

## 8. Manejo del error P2002 (unique violation)

Defensa en profundidad: aunque el controller chequea duplicados con `getByEmail`, una carrera puede provocar `P2002`. Capturar en `error-handler.js`:

```js
if (err.code === 'P2002') return res.status(409).json({ error: 'Email already registered' })
```

## 9. Tests e2e (`app.test.js`)

Escenarios (en orden, compartiendo servidor en puerto dedicado):

1. `POST /register` válido ⇒ 201 `{ id, email }`.
2. `POST /register` mismo email ⇒ 409.
3. `POST /register` password corta ⇒ 400 + `details[0].path = ['password']`.
4. `POST /login` correcto ⇒ 200 con token decodificable (`jwt.verify` con `config.jwtSecret`).
5. `POST /login` password incorrecta ⇒ 401 mensaje genérico.
6. Request protegido sin token ⇒ 401 (se valida ya aquí contra un endpoint dummy o se deja para Feature 002).
