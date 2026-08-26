# Plan Técnico — Feature 005 Listado Paginado

## Archivos a crear/modificar

| Archivo | Acción | Responsabilidad |
|---|---|---|
| `backend/schemas/image.schema.js` | sin cambios | `imageListQuerySchema` ya definido en F002 |
| `backend/models/image.model.js` | sin cambios | `list` (transacción findMany+count) ya definido en F002 |
| `backend/controllers/image.controller.js` | modificar | método `getAll` |
| `backend/routes/image.routes.js` | modificar | GET `/images` con validate en `query` |
| OpenAPI | modificar | `ImagePage`, params query |

## 1. Validación de query (middleware con source='query')

El schema de F002 se reutiliza apuntando el validador a `req.query`:

```js
// schemas/image.schema.js — ya existe desde Feature 002
export const imageListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(config.pagination.maxLimit).default(config.pagination.defaultLimit)
})
```

En la ruta se usa la factory genérica con source:

```js
import { validate } from '../middlewares/validate.js'
router.get('/images', verifyToken, validate(imageListQuerySchema, 'query'), imageController.getAll)
```

`validate(schema, 'query')` parsea y REESCRIBE `req.query` con defaults aplicados (`page`, `limit` numéricos), de modo que el controller recibe tipos correctos sin casts.

## 2. Controller — método `getAll`

```js
async getAll(req, res) {
  const { page, limit } = req.query // ya normalizados por Zod
  const [items, total] = await imageModel.list({ userId: req.user.sub, page, limit })

  return res.status(200).json({
    data: items.map(image => ({
      id: image.id,
      filename: image.filename,
      mimeType: image.mimeType,
      size: image.size,
      width: image.width,
      height: image.height,
      url: `/api/v1/images/${image.id}/file`,
      createdAt: image.createdAt
    })),
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit)
    }
  })
}
```

## 3. Modelo (referencia — implementado en F002)

```js
list({ userId, page = 1, limit = 10 }) {
  return prisma.$transaction([
    prisma.image.findMany({
      where: { userId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (page - 1) * limit,
      take: limit
    }),
    prisma.image.count({ where: { userId } })
  ])
}
```

La transacción garantiza consistencia entre página y total. El desempate `{ id: 'desc' }` evita saltos de elementos cuando dos imágenes comparten timestamp.

## 4. Rutas completas del módulo (estado final tras las 5 features)

```js
// routes/image.routes.js
const router = Router()

router.post('/images', verifyToken, uploadSingle, imageController.create)
router.get('/images', verifyToken, validate(imageListQuerySchema, 'query'), imageController.getAll)
router.get('/images/:id', verifyToken, imageController.getId)
router.get('/images/:id/file', verifyToken, imageController.getFile)
router.post('/images/:id/transform', verifyToken, validate(transformImageSchema), imageController.transform)
router.get('/images/:id/variants/:variantId', verifyToken, imageController.getVariantFile)

export default router
```

## 5. Tests e2e

Setup: usuario A sube 3 fixtures; usuario B sube 1.

Escenarios:
1. Usuario A sin params ⇒ 200, `data.length === 3`, `pagination = { page:1, limit:10, total:3, totalPages:1 }`.
2. Orden DESC: primer item es el último subido.
3. Aislamiento: listado de B solo contiene su imagen.
4. `?limit=2&page=2` ⇒ 1 elemento, `totalPages=2`.
5. `?page=99` ⇒ `data: []`, pagination consistente.
6. `?limit=500` / `?page=0` / `?page=abc` ⇒ 400 con details de Zod.
7. Sin token ⇒ 401.
