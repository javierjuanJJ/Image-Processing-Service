# Image Processing Service

API de gestión y procesamiento de imágenes tipo Cloudinary (self-hosted). Node.js 22+ · Express 5 · Prisma · PostgreSQL · Sharp · Zod · JWT.

Toda la documentación funcional vive en [`spec/`](spec/constitution/mission.md); los contratos HTTP están en OpenAPI 3.1 servidos por Swagger UI.

## Endpoints

| Método | Ruta | Descripción |
|---|---|---|
| POST | `/api/v1/register` | Registro de usuario |
| POST | `/api/v1/login` | Login → `{ token, expiresIn }` |
| POST | `/api/v1/images` | Sube imagen (multipart, campo `image`) |
| GET | `/api/v1/images` | Listado paginado (`page`, `limit`) |
| GET | `/api/v1/images/:id` | Detalle con variantes |
| GET | `/api/v1/images/:id/file` | Binario original (`?download=1`) |
| POST | `/api/v1/images/:id/transform` | Transforma (resize/crop/rotate/filtros/formato) |
| GET | `/api/v1/images/:id/variants/:variantId` | Descarga variante |

Docs interactivas: `http://localhost:3000/docs`

## Puesta en marcha

```bash
cd backend
cp .env.example .env          # ajusta DATABASE_URL y JWT_SECRET
npm install
npx prisma migrate deploy     # crea tablas (migración inicial incluida)
npm run dev                   # http://localhost:3000
```

Requiere PostgreSQL accesible vía `DATABASE_URL`. La migración inicial está versionada en `backend/prisma/migrations/`.

## Docker (API + microservicios)

```bash
cp .env.example .env          # opcional: ajusta JWT_SECRET, puertos, etc.
docker compose up --build
```

Servicios que levanta la pila:

| Servicio | Descripción | Puerto |
|---|---|---|
| `api` | API Express (aplica migraciones y sirve `/api/v1` y `/docs`) | `3000` |
| `worker` | Consumidor de la cola `image.transforms` | — |
| `postgres` | Base de datos de metadatos | `5432` |
| `rabbitmq` | Cola de transformaciones asíncronas (+ consola de gestión) | `5672` / `15672` |
| `floci` | Emulador local de AWS con **S3** en `http://localhost:4566` | `4566` |
| `floci-init` | Job one-shot que crea el bucket S3 al arrancar | — |

Por defecto el almacenamiento apunta al **S3 emulado por Floci** (`STORAGE_PROVIDER=s3`,
`STORAGE_ENDPOINT=http://floci:4566`, credenciales `test`/`test`). Para usar disco local,
pon `STORAGE_PROVIDER=disk` en `.env`.

```bash
# Inspeccionar el bucket emulado
AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test \
  aws --endpoint-url http://localhost:4566 s3 ls s3://image-processing
```

## Tests e2e

```bash
# necesita una BD desechable; ajusta .env o exporta:
export DATABASE_URL="postgresql://postgres:postgres@localhost:5432/image_processing_test?schema=public"
npm test                      # node --test (26 tests, puerto efímero)
```

La suite cubre registro/login/JWT, carga multipart (metadatos reales vía sharp), ownership 404, descarga byte a byte, paginación/aislamiento y transformaciones idempotentes. Limpia tablas y carpeta `uploads-test/` al terminar.

## Transformaciones asíncronas (opcional)

Con `QUEUE_ENABLED=true` y RabbitMQ corriendo en `RABBIT_URL`, `POST /images/:id/transform` responde `202 { status: 'pending', transformId }` y un worker procesa la cola:

```bash
npm run worker                # consume image.transforms; marca logs done/failed
```

## Estructura

`routes → controllers → models → prisma`. Los schemas Zod son la única fuente de verdad de los contratos; solo `models/` toca Prisma; env vars solo en `config.js`. Ver `spec/constitution/tech-stack.md`.
