# Plan Técnico — Feature 004 Detalle e Imagen

## Archivos a crear/modificar

| Archivo | Acción | Responsabilidad |
|---|---|---|
| `backend/controllers/image.controller.js` | modificar | métodos `getId`, `getFile` |
| `backend/routes/image.routes.js` | modificar | GET `/:id` y GET `/:id/file` |
| `backend/models/image.model.js` | sin cambios | `getById` ya existe desde F002 |
| OpenAPI | modificar | `ImageDetail`, endpoints |

## 1. Controller — método `getId`

```js
async getId(req, res) {
  const image = await imageModel.getById(req.params.id)
  if (!image || image.userId !== req.user.sub) {
    return res.status(404).json({ error: 'Image not found' })
  }

  const variants = Object.fromEntries(
    Object.entries(image.variants ?? {}).map(([variantId, v]) => [
      variantId,
      {
        url: `/api/v1/images/${image.id}/variants/${variantId}`,
        mimeType: v.mimeType,
        size: v.size,
        width: v.width,
        height: v.height
      }
    ])
  )

  return res.status(200).json({
    id: image.id,
    filename: image.filename,
    mimeType: image.mimeType,
    size: image.size,
    width: image.width,
    height: image.height,
    url: `/api/v1/images/${image.id}/file`,
    variants,
    createdAt: image.createdAt
  })
}
```

Nota: el shape base coincide con la respuesta de F002 (`create`) salvo `variants`. Extraer un helper `serializeImage(image, { withVariants })` si se detecta duplicación; v1 acepta dos serializaciones explícitas.

## 2. Controller — método `getFile`

```js
import path from 'node:path'
import { stat } from 'node:fs/promises'

async getFile(req, res) {
  const image = await imageModel.getById(req.params.id)
  if (!image || image.userId !== req.user.sub) {
    return res.status(404).json({ error: 'Image not found' })
  }

  const absPath = path.join(config.uploadsDir, image.storagePath)

  try {
    await stat(absPath)
  } catch {
    return res.status(404).json({ error: 'File missing' })
  }

  res.setHeader('Content-Type', image.mimeType)
  res.setHeader('Content-Length', image.size)
  res.setHeader('Cache-Control', 'private, max-age=3600')
  if (req.query.download === '1') {
    res.setHeader('Content-Disposition', `attachment; filename="${image.filename}"`)
  }
  return res.sendFile(absPath)
}
```

Seguridad del header: `filename` ya viene sanitizado por Zod en F002 (sin comillas ni caracteres de control), por lo que es seguro inyectarlo en Content-Disposition.

## 3. Rutas

```js
router.get('/images/:id', verifyToken, imageController.getId)
router.get('/images/:id/file', verifyToken, imageController.getFile)
```

Orden en el router: declarar rutas estáticas (`/images`, `/images/:id/file`) antes que patrones más generales si Express 5 lo exige por orden de match — aquí no colisionan porque `:id` solo aparece al final del path.

## 4. Tests e2e

Reutilizan fixture/registro de F002:

1. Upload → `GET /images/:id` ⇒ 200 + shape completo (comparar campos con respuesta del upload).
2. Segundo usuario (registro+login propios) pide la misma imagen ⇒ 404.
3. `GET /images/:id/file` ⇒ 200, body igual byte a byte al buffer subido (`Buffer.compare === 0`), Content-Type correcto.
4. `?download=1` ⇒ Content-Disposition presente.
5. Sin token ⇒ 401 en ambos.
6. Borrar archivo físico manualmente ⇒ 404 `File missing`.
