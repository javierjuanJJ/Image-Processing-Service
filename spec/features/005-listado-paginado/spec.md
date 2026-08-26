# Feature 005 — Listado Paginado de Imágenes

## Resumen

Listar las imágenes del usuario autenticado con paginación por `page` y `limit`, orden descendente por fecha de creación, incluyendo el total para que el cliente construya la navegación.

## Casos de uso

1. **Como usuario**, quiero listar mis imágenes en páginas de N elementos con metadatos resumidos.
2. **Como cliente**, quiero saber `total` y `totalPages` para pintar un paginador.
3. **Como API**, debo acotar `limit` (máx 50) y normalizar `page` para evitar consultas descontroladas.

## Contrato OpenAPI

```yaml
paths:
  /api/v1/images:
    get:
      summary: Lista paginada de imágenes del usuario
      tags: [Images]
      security: [{ bearerAuth: [] }]
      parameters:
        - name: page
          in: query
          schema: { type: integer, minimum: 1, default: 1 }
        - name: limit
          in: query
          schema: { type: integer, minimum: 1, maximum: 50, default: 10 }
      responses:
        '200':
          description: Página de imágenes
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ImagePage'
              example:
                data:
                  - id: b3c1d9e0-...
                    filename: foto-playa.jpg
                    mimeType: image/jpeg
                    size: 482113
                    width: 1920
                    height: 1080
                    url: /api/v1/images/b3c1d9e0-.../file
                    createdAt: '2026-08-26T10:00:00.000Z'
                  - id: a1b2c3d4-...
                    filename: logo.png
                    mimeType: image/png
                    size: 8123
                    width: 512
                    height: 512
                    url: /api/v1/images/a1b2c3d4-.../file
                    createdAt: '2026-08-25T18:30:00.000Z'
                pagination:
                  page: 1
                  limit: 10
                  total: 23
                  totalPages: 3
        '400':
          description: Query inválida (p. ej. page=0, limit=999)
        '401': { $ref: '#/components/responses/Unauthorized' }

components:
  schemas:
    ImageSummary:
      type: object
      properties:
        id: { type: string, format: uuid }
        filename: { type: string }
        mimeType: { type: string }
        size: { type: integer }
        width: { type: integer, nullable: true }
        height: { type: integer, nullable: true }
        url: { type: string }
        createdAt: { type: string, format: date-time }
    ImagePage:
      type: object
      required: [data, pagination]
      properties:
        data:
          type: array
          items: { $ref: '#/components/schemas/ImageSummary' }
        pagination:
          type: object
          properties:
            page: { type: integer }
            limit: { type: integer }
            total: { type: integer }
            totalPages: { type: integer }
```

## Reglas de negocio

- Filtro SIEMPRE por `userId = req.user.sub` (aislamiento multiusuario).
- Orden fijo: `createdAt DESC` (más recientes primero); desempate estable por `id` si hiciera falta.
- Defaults desde config: `limit=10`, máx `50`. Valores no numéricos/negativos/cero ⇒ 400 vía Zod (`z.coerce` convierte strings numéricos).
- `totalPages = ceil(total / limit)`; página fuera de rango NO es error ⇒ devuelve `data: []` con `pagination` correcto.
- El listado devuelve **resúmenes** sin mapa de variantes (evitar payloads pesados); el detalle completo está en F004.
- Rendimiento: única transacción Prisma `findMany + count`; índice compuesto `[userId, createdAt DESC]`.

## Criterios de aceptación

- [ ] `GET /images` sin params ⇒ página 1, limit 10, shape `{ data, pagination }`.
- [ ] Con 23 imágenes y `limit=10`: página 1 tiene 10 items, página 3 tiene 3, `totalPages=3`.
- [ ] `?page=99` ⇒ 200 con `data: []` y pagination consistente.
- [ ] `?limit=500` ⇒ 400 (supera máximo). `?page=0` o `?page=abc` ⇒ 400.
- [ ] Solo aparecen imágenes del usuario autenticado (verificado con dos usuarios en tests).
- [ ] Orden descendente por `createdAt` verificado en test con ≥ 2 uploads secuenciales.
- [ ] Tests e2e cubren todos los escenarios.
