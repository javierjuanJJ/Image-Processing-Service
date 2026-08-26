# Roadmap

Estado de cada feature. Una feature solo pasa a `done` cuando su checklist `tasks.md` está 100% completa y los tests e2e correspondientes pasan.

| ID | Feature | Estado | Dependencias | Entregable clave |
|---|---|---|---|---|
| 001 | Autenticación de Usuarios | `code-complete`* | — (fundacional) | `POST /api/v1/register`, `POST /api/v1/login`, middleware JWT |
| 002 | Carga de Imágenes | `code-complete`* | 001 | `POST /api/v1/images` multipart, metadatos en PostgreSQL |
| 003 | Transformación de Imágenes | `code-complete`* | 002 | `POST /api/v1/images/:id/transform` con Sharp (+ cola opcional) |
| 004 | Detalle e Imagen | `code-complete`* | 002 | `GET /api/v1/images/:id` y servido del binario |
| 005 | Listado Paginado | `code-complete`* | 002 | `GET /api/v1/images?page=1&limit=10` |

> \* `code-complete`: implementación y tests e2e **escritos** (26 tests en `backend/app.test.js`), pendientes de ejecución contra PostgreSQL real según la nota de infraestructura. Pasarán a `done` cuando la suite esté verde.

## Orden de implementación recomendado

```
001 → 002 → {004 ∥ 005} → 003
```

- **001 primero**: el resto de endpoints requieren `verifyToken`.
- **002 antes que 3/4/5**: sin imágenes cargadas no hay nada que transformar/servir/listar.
- **004 y 005 son paralelizables** entre dos desarrolladores.
- **003 al final**: es la feature más compleja (Sharp + variantes + posible RabbitMQ).

## Definición de "done" global

1. Código en las capas correctas (`routes → controllers → models`) según `tech-stack.md`.
2. Schemas Zod exportando `validate*` y `validatePartial*`.
3. Tests e2e en `app.test.js` verdes (contrato HTTP completo).
4. OpenAPI actualizado en la spec agregada.
5. Checklist de `tasks.md` completado.

> Nota sobre BD: si en el entorno no hay PostgreSQL disponible, se implementa el código y los tests SIN ejecutarlos; la persona responsable validará contra una BD real. No bloquear la entrega por falta de infraestructura.

## Post-v1 (backlog, fuera de estas specs)

- Watermarks con Sharp composite.
- Eliminación de variantes huérfanas (GC de storage).
- Rate limiting por usuario.
- Métricas Prometheus.
