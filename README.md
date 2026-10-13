# Image Processing Service

API REST de gestión y procesamiento de imágenes tipo Cloudinary (self-hosted): autenticación JWT, carga de imágenes, transformaciones con [Sharp](https://sharp.pixelplumbing.com/) (resize, crop, rotate, filtros, conversión de formato) y almacenamiento abstraído (disco local, AWS S3, Cloudflare R2 o Google Cloud Storage).

![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A522-brightgreen)
![Express](https://img.shields.io/badge/Express-5-000000)
![Prisma](https://img.shields.io/badge/Prisma-6-2D3748)
![OpenAPI](https://img.shields.io/badge/OpenAPI-3.1-6BA539)
![Tests](https://img.shields.io/badge/tests-26%20passing-success)

## Índice

1. [Descripción y funcionamiento](#descripción-y-funcionamiento)
2. [Arquitectura y estructura del proyecto](#arquitectura-y-estructura-del-proyecto)
3. [Requisitos](#requisitos)
4. [Despliegue con Docker](#despliegue-con-docker)
5. [Despliegue sin Docker (local)](#despliegue-sin-docker-local)
6. [Variables de entorno](#variables-de-entorno)
7. [Dominio de datos](#dominio-de-datos)
8. [Referencia de endpoints](#referencia-de-endpoints)
9. [Resultados de las pruebas](#resultados-de-las-pruebas)
10. [Ejemplos de uso](#ejemplos-de-uso)
11. [Tests](#tests)
12. [Documentación y contribución](#documentación-y-contribución)

## Descripción y funcionamiento

El servicio expone un catálogo de imágenes **privado por usuario**. Cada petición protegida se autentica con un JWT (`Authorization: Bearer <token>`). El flujo general es:

1. **Autenticación** — `POST /register` crea el usuario (contraseña hasheada con bcrypt) y `POST /login` devuelve un JWT firmado (HS256) con `sub` = id de usuario y expiración configurable (por defecto `1h`).
2. **Carga** — `POST /images` recibe un `multipart/form-data` (campo `image`). El binario se valida con Sharp (se extraen **metadatos reales**: MIME, ancho, alto, tamaño) y se sube al backend de almacenamiento configurado. En base de datos solo se guardan metadatos + la clave del objeto, nunca el binario.
3. **Lectura** — listado paginado y detalle por imagen. El acceso está aislado por usuario: pedir una imagen ajena o inexistente responde siempre `404`.
4. **Transformación** — `POST /images/:id/transform` aplica operaciones a la imagen original y guarda el resultado como **variante**. El identificador de variante es determinista: `sha256(imageId + JSON(transforms))` truncado a 8 caracteres, por lo que repetir la misma transformación reutiliza la variante existente (idempotencia).
5. **Cola asíncrona (opcional)** — con `QUEUE_ENABLED=true` la transformación se publica en RabbitMQ (cola durable `image.transforms`), la API responde `202 { status: "pending", transformId }` y un **worker** la procesa en segundo plano, registrando el estado en `transform_logs` (`pending` → `done`/`failed`). Con `QUEUE_ENABLED=false` la transformación es síncrona y se devuelve la variante en la misma petición.

### Limitaciones

- Tamaño máximo de subida: **10 MB**. MIME permitidos: `image/jpeg`, `image/png`, `image/webp`, `image/gif`, `image/avif`.
- No hay borrado ni actualización de imágenes (solo creación y consulta).
- La validación de límites físicos del `crop` (recorte fuera de la imagen) con cola activa se detecta **en el worker** (log `failed`), no en la respuesta HTTP.
- El detalle de imagen (`variants`) es la única vía para descubrir el `variantId` de una transformación asíncrona.

## Arquitectura y estructura del proyecto

```mermaid
flowchart LR
  C[Cliente / curl / Postman] -->|HTTP :3000| API[api<br/>Express 5]
  API -->|SQL| PG[(postgres:16<br/>metadatos)]
  API -->|amqp| MQ[(rabbitmq<br/>cola image.transforms)]
  API -->|S3 API| F[floci:4566<br/>emulador AWS S3]
  API -->|lectura/escritura| D[(disco /uploads)]
  W[worker] -->|consume| MQ
  W -->|SQL| PG
  W -->|S3 API| F
  W -->|lectura/escritura| D
  F --> VOL[(volumen floci-data)]
  PG --> PGV[(volumen postgres-data)]
```

Flujo de una petición de transformación (con cola activa):

```mermaid
sequenceDiagram
  participant Cli as Cliente
  participant API as api
  participant PG as postgres
  participant MQ as rabbitmq
  participant W as worker
  participant S3 as floci (S3)

  Cli->>API: POST /images/:id/transform (Bearer JWT)
  API->>PG: verifica ownership
  API->>PG: inserta transform_log (pending)
  API->>MQ: publica {logId, imageId, storagePath, transforms} (confirm)
  API-->>Cli: 202 {status:"pending", transformId}
  MQ-->>W: entrega mensaje
  W->>S3: descarga original
  W->>W: sharp.resize/crop/rotate/filters/format
  W->>S3: sube variante
  W->>PG: añade variante + marca log done
  Cli->>API: GET /images/:id (Bearer JWT)
  API-->>Cli: detalle con variants{variantId:...}
```

### Estructura de carpetas

```
Image-Processing-Service/
├── docker-compose.yml        # pila completa: api, worker, postgres, rabbitmq, floci, floci-init
├── .env.example              # plantilla para docker compose (raíz)
├── README.md
├── spec/                     # especificación funcional (constitution + features 001..005)
└── backend/
    ├── app.js                # bootstrap Express: CORS, JSON, /docs (Swagger UI), rutas, error handler
    ├── config.js             # única fuente de variables de entorno
    ├── Dockerfile            # imagen multi-stage (deps -> prisma generate -> runtime)
    ├── docker-entrypoint.sh  # aplica migraciones si RUN_MIGRATIONS=true
    ├── .env.example          # plantilla de entorno para ejecución local (sin Docker)
    ├── docs/openapi.json     # contrato OpenAPI 3.1 servido en /docs
    ├── prisma/
    │   ├── schema.prisma     # modelos User / Image / TransformLog
    │   └── migrations/       # migración inicial versionada
    ├── routes/               # auth.routes.js, image.routes.js, index.js
    ├── controllers/          # auth.controller.js, image.controller.js
    ├── models/               # acceso a Prisma (solo aquí se toca la BD)
    ├── schemas/              # esquemas Zod (contratos de entrada)
    ├── middlewares/          # auth (JWT), validate (Zod), upload (multer), cors, error-handler
    ├── services/             # storage.service.js, sharp.service.js, queue.service.js
    ├── workers/              # transform.worker.js
    └── app.test.js           # 26 tests e2e con node --test
```

## Requisitos

| Componente | Versión mínima | Uso |
|---|---|---|
| Node.js | **22** | Runtime (usa `fetch`, `node --test`, `--env-file-if-exists`) |
| npm | 10 | Gestión de dependencias |
| PostgreSQL | 14+ (se usa 16) | Metadatos (usuarios, imágenes, logs) |
| Docker + Compose | Engine 24+ / Compose v2 | Despliegue con contenedores |
| RabbitMQ | 3.13 | Opcional, solo si `QUEUE_ENABLED=true` |
| S3 / R2 / GCS | — | Opcional; también se admite disco local |

Sharp requiere binarios nativos; se instala automáticamente como dependencia precompilada (`npm ci`).

## Despliegue con Docker

El `docker-compose.yml` levanta **seis servicios**: `api`, `worker`, `postgres`, `rabbitmq`, `floci` (emulador local de AWS con S3) y `floci-init` (job one-shot que crea el bucket). Por defecto el almacenamiento apunta al **S3 emulado** (`STORAGE_PROVIDER=s3`).

### Paso a paso

```bash
# 1. Clona el repositorio y entra en él
git clone https://github.com/javierjuanJJ/Image-Processing-Service.git
cd Image-Processing-Service

# 2. Crea el archivo de entorno a partir de la plantilla y ajusta secretos/puertos
cp .env.example .env
#    Edita como mínimo JWT_SECRET. Opcionalmente API_PORT, POSTGRES_PORT, etc.

# 3. (Opción A) Usa la imagen publicada en Docker Hub
docker compose pull

# 3'. (Opción B) Construye la imagen localmente desde backend/Dockerfile
#     El compose referencia la imagen con tag jjal20021998/image-processing-api:latest,
#     así que compílala con ese mismo tag:
docker build -t jjal20021998/image-processing-api:latest ./backend

# 4. Levanta la pila en segundo plano
docker compose up -d

# 5. Comprueba el estado (api y postgres se declaran healthy)
docker compose ps
docker compose logs -f api worker      # sigue los logs (Ctrl+C para salir)

# 6. Verifica que la API responde
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/docs/    # -> 200
```

> Nota: el `docker-compose.yml` **no** incluye una directiva `build:`; `docker compose up --build`
> por sí solo no recompila la imagen porque el compose referencia una imagen publicada. Para
> compilar desde el código usa el `docker build` del paso 3'.

### Servicios de la pila

| Servicio | Imagen | Descripción | Puertos (host) |
|---|---|---|---|
| `api` | `jjal20021998/image-processing-api:latest` | API Express; aplica migraciones (`RUN_MIGRATIONS=true`) y sirve `/api/v1` y `/docs` | `3000` |
| `worker` | `jjal20021998/image-processing-api:latest` | Consumidor de `image.transforms` | — |
| `postgres` | `postgres:16-alpine` | Base de datos de metadatos | `5432` |
| `rabbitmq` | `rabbitmq:3.13-management-alpine` | Cola de transformaciones + consola de gestión | `5672` / `15672` |
| `floci` | `floci/floci:latest` | Emulador local de AWS; expone S3 en `:4566` | `4566` |
| `floci-init` | `amazon/aws-cli:latest` | Job one-shot: espera a Floci y crea el bucket S3 | — |

### Consola de gestión y almacenamiento

- **RabbitMQ management**: http://localhost:15672 (usuario/contraseña `guest`/`guest`).
- **Swagger UI**: http://localhost:3000/docs
- **Floci health**: http://localhost:4566/_floci/health → `200`
- Inspeccionar el bucket S3 emulado:

```bash
AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test AWS_DEFAULT_REGION=us-east-1 \
  aws --endpoint-url http://localhost:4566 s3 ls s3://image-processing --recursive
# o dentro de la red de compose:
docker run --rm --network image-processing-service_default \
  -e AWS_ACCESS_KEY_ID=test -e AWS_SECRET_ACCESS_KEY=test -e AWS_DEFAULT_REGION=us-east-1 \
  amazon/aws-cli:latest --endpoint-url http://floci:4566 s3 ls s3://image-processing --recursive
```

### Operación

```bash
docker compose down          # detiene y elimina contenedores (conserva volúmenes/datos)
docker compose down -v       # además borra volúmenes: postgres-data, uploads, rabbitmq-data, floci-data
docker compose restart api   # reinicia solo la API
docker compose exec postgres psql -U postgres -d image_processing   # shell SQL
```

### Usar disco local en lugar de S3

En `.env`, pon `STORAGE_PROVIDER=disk` (el endpoint S3 se ignora) y recrea api/worker:

```bash
STORAGE_PROVIDER=disk docker compose up -d --force-recreate api worker
```

## Despliegue sin Docker (local)

### Paso a paso

```bash
# 1. Instala PostgreSQL y arranca el servicio (ejemplo en Debian/Ubuntu)
sudo apt-get install -y postgresql
sudo systemctl start postgresql

# 2. Crea la base de datos de desarrollo
sudo -u postgres createdb image_processing

# 3. Entra en el backend y crea el entorno
cd backend
cp .env.example .env
```

Edita `backend/.env` con, al menos:

```dotenv
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/image_processing?schema=public"
JWT_SECRET="un-secreto-largo-y-aleatorio"
STORAGE_PROVIDER=disk      # almacenamiento en disco local (backend/uploads)
QUEUE_ENABLED=false        # transformaciones síncronas, sin RabbitMQ
```

```bash
# 4. Instala dependencias
npm install

# 5. Aplica las migraciones (crea las tablas)
npx prisma migrate deploy      # equivalente: npm run db:migrate

# 6. Arranca en modo desarrollo (recarga al guardar)
npm run dev                    # http://localhost:3000
#    o en modo normal:
npm start
```

El `.env` se carga automáticamente por los scripts (`node --env-file-if-exists=.env`).

### Worker de transformaciones (opcional, requiere RabbitMQ)

Para procesar transformaciones de forma asíncrona en local:

```dotenv
QUEUE_ENABLED=true
RABBIT_URL=amqp://localhost
```

```bash
npm run worker   # consume la cola image.transforms
```

Con `QUEUE_ENABLED=true` pero sin worker en ejecución, `POST /images/:id/transform` seguirá respondiendo `202` pero la variante nunca se generará (el log queda `pending`).

### Scripts disponibles (`backend/package.json`)

| Script | Comando | Descripción |
|---|---|---|
| `npm run dev` | `node --watch app.js` | Desarrollo con recarga |
| `npm start` | `node app.js` | Producción/local |
| `npm run worker` | `node workers/transform.worker.js` | Consumidor de la cola |
| `npm test` | `node --test` | Suite e2e (26 tests) |
| `npm run db:generate` | `prisma generate` | Genera el cliente Prisma |
| `npm run db:migrate` | `prisma migrate deploy` | Aplica migraciones |
| `npm run db:migrate:dev` | `prisma migrate dev` | Crea/aplica migraciones en desarrollo |

## Variables de entorno

Todas las variables se leen en `backend/config.js`. Las de la raíz (`.env.example`) alimentan `docker compose`; las de `backend/.env.example` alimentan la ejecución local.

| Variable | Por defecto (compose) | Descripción |
|---|---|---|
| `JWT_SECRET` | `change-me-in-production` | **Obligatoria**. Clave de firma del JWT |
| `JWT_EXPIRES_IN` | `1h` | Expiración del token |
| `CORS_ORIGINS` | `http://localhost:5173` | Orígenes permitidos (separados por coma) |
| `PORT` / `API_PORT` | `3000` | Puerto de la API |
| `DATABASE_URL` | `postgresql://postgres:postgres@postgres:5432/image_processing` | Conexión Prisma/PostgreSQL |
| `QUEUE_ENABLED` | `true` | `true` = transformaciones asíncronas vía RabbitMQ |
| `RABBIT_URL` | `amqp://guest:guest@rabbitmq:5672` | Conexión AMQP |
| `STORAGE_PROVIDER` | `s3` | `disk` \| `s3` \| `r2` \| `gcs` |
| `STORAGE_BUCKET` | `image-processing` | Bucket S3/R2/GCS |
| `STORAGE_REGION` | `us-east-1` | Región S3 |
| `STORAGE_ENDPOINT` | `http://floci:4566` | Endpoint S3 (vacío = AWS real; Floci/R2 lo usan) |
| `STORAGE_ACCESS_KEY_ID` / `STORAGE_SECRET_ACCESS_KEY` | `test` / `test` | Credenciales S3/R2 |
| `STORAGE_KEY_FILENAME` | — | Clave de servicio GCS |
| `UPLOADS_DIR` | `/app/uploads` (Docker) / `uploads` (local) | Directorio para `STORAGE_PROVIDER=disk` |

Otras claves de compose: `POSTGRES_USER`/`POSTGRES_PASSWORD`/`POSTGRES_DB`/`POSTGRES_PORT`, `RABBITMQ_USER`/`RABBITMQ_PASS`/`RABBITMQ_PORT`/`RABBITMQ_MANAGEMENT_PORT`, `FLOCI_PORT`, `FLOCI_STORAGE_MODE`.

## Dominio de datos

### Entrada

- **JSON** para `register`/`login` y para el cuerpo de `transform`.
- **`multipart/form-data`** para `POST /images`: campo `image` (archivo obligatorio), campo `filename` (opcional, se sanea).
- **Query params** en `GET /images` (`page`, `limit`) y en descargas (`download=1`).
- **Cabecera** `Authorization: Bearer <JWT>` en todos los endpoints de imágenes.

### Salida

- JSON de metadatos (`{ data, pagination }`, detalle, variantes) con formato de error uniforme `{ "error": string, "details"?: [...] }`.
- Binarios imagen (`Content-Type` del MIME real) con `Cache-Control: private, max-age=3600`, y `Content-Disposition: attachment` si `download=1`.

### Persistencia

**PostgreSQL** (Prisma) — `backend/prisma/schema.prisma`:

| Tabla | Modelo | Campos clave |
|---|---|---|
| `users` | `User` | `id` (uuid), `email` (único), `password` (bcrypt), timestamps |
| `images` | `Image` | `id` (uuid), `userId`, `filename`, `mimeType`, `size`, `width`, `height`, `storagePath`, `variants` (JSON), timestamps |
| `transform_logs` | `TransformLog` | `id` (cuid), `imageId`, `operation` (JSON), `status` (`pending|done|failed`), `createdAt` |

**Almacenamiento de objetos** — el binario nunca se guarda en la BD. Claves (formato POSIX):

```
YYYY/MM/{imageId}{ext}                       # original, p.ej. 2026/10/fb7b…cd.jpeg
YYYY/MM/{imageId}/{variantId}{ext?}          # variante, p.ej. 2026/10/fb7b…cd/0c1bd060
```

La extensión de la variante solo se añade si la transformación fija `format`; si no, hereda el MIME original.

## Referencia de endpoints

Base URL: `http://localhost:3000`. Todos los endpoints de imágenes requieren `Authorization: Bearer <token>`. Especificación interactiva completa (OpenAPI 3.1) en **`/docs`**.

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| POST | `/api/v1/register` | — | Registra un usuario |
| POST | `/api/v1/login` | — | Autentica y devuelve JWT |
| POST | `/api/v1/images` | Bearer | Sube imagen (`multipart`, campo `image`) |
| GET | `/api/v1/images` | Bearer | Listado paginado del usuario |
| GET | `/api/v1/images/:id` | Bearer | Detalle + variantes |
| GET | `/api/v1/images/:id/file` | Bearer | Binario original (`?download=1`) |
| POST | `/api/v1/images/:id/transform` | Bearer | Aplica transformación → variante |
| GET | `/api/v1/images/:id/variants/:variantId` | Bearer | Descarga una variante |

### `POST /api/v1/register`

| Campo | Tipo | Obligatorio | Reglas |
|---|---|---|---|
| `email` | string | sí | formato email; se normaliza a minúsculas |
| `password` | string | sí | mínimo 8 caracteres |

Respuestas: `201 { id, email }` · `400` validación (`error`, `details[{path,message}]`) · `409 { error: "Email already registered" }`.

### `POST /api/v1/login`

| Campo | Tipo | Obligatorio | Reglas |
|---|---|---|---|
| `email` | string | sí | formato email |
| `password` | string | sí | mínimo 1 carácter |

Respuestas: `200 { token, expiresIn }` · `400` validación · `401 { error: "Invalid credentials" }` (genérico para usuario inexistente o contraseña errónea).

### `POST /api/v1/images`

`multipart/form-data`:

| Campo | Tipo | Obligatorio | Reglas |
|---|---|---|---|
| `image` | file | sí | MIME ∈ jpeg/png/webp/gif/avif; ≤ 10 MB; contenido validado con Sharp |
| `filename` | string | no | se sanea (`[^\w.\- ]` eliminado); por defecto el nombre original |

Respuestas: `201 { id, filename, mimeType, size, width, height, url, createdAt }` · `400 { error: "No image file provided" | "Unsupported image type" | "Invalid image content" }` · `401` · `413 { error: "File too large", details:["10MB max"] }`.

### `GET /api/v1/images`

| Query | Tipo | Obligatorio | Reglas |
|---|---|---|---|
| `page` | int | no | ≥ 1 (por defecto `1`) |
| `limit` | int | no | 1–50 (por defecto `10`) |

Respuestas: `200 { data: [...], pagination: { page, limit, total, totalPages } }` · `400` validación · `401`. Orden: `createdAt` descendente.

### `GET /api/v1/images/:id`

Respuestas: `200` detalle `{ id, filename, mimeType, size, width, height, url, variants: { variantId: { url, mimeType, size, width, height } }, createdAt }` · `401` · `404 { error: "Image not found" }` (también para id malformado o imagen de otro usuario).

### `GET /api/v1/images/:id/file`

| Query | Tipo | Efecto |
|---|---|---|
| `download` | string | `1` añade `Content-Disposition: attachment; filename="..."` |

Respuestas: `200` binario original · `401` · `404` (imagen ajena/inexistente o fichero ausente).

### `POST /api/v1/images/:id/transform`

Cuerpo JSON; se exige **al menos una** operación:

| Campo | Tipo | Reglas |
|---|---|---|
| `resize` | objeto | `{ width?, height?, fit? }`; exige `width` o `height`; rango 1–8000; `fit` ∈ `cover|contain|fill|inside|outside` (def. `cover`) |
| `crop` | objeto | `{ left, top, width, height }` enteros; se valida contra los límites reales de la imagen |
| `rotate` | int | `0 | 90 | 180 | 270` |
| `filters` | objeto | `{ grayscale?, sepia? }` booleanos |
| `format` | enum | `jpeg | png | webp | avif | gif` |

Respuestas con `QUEUE_ENABLED=true`: `202 { status: "pending", transformId }` · con `QUEUE_ENABLED=false`: `201 { imageId, variantId, url, mimeType, size, width, height, appliedTransforms }`. Errores: `400` (validación o `Crop out of bounds` en modo síncrono) · `401` · `404`.

### `GET /api/v1/images/:id/variants/:variantId`

Respuestas: `200` binario · `401` · `404 { error: "Variant not found" }`.

## Resultados de las pruebas

Pruebas ejecutadas contra la pila desplegada con `docker compose` (API en `http://localhost:3000`, `QUEUE_ENABLED=true`, `STORAGE_PROVIDER=s3` vía Floci). `✔` = comportamiento real == esperado.

### Autenticación

| Petición | Respuesta real | Estado |
|---|---|---|
| `POST /register` válido | `201 {id,email}` | ✔ |
| `POST /register` email duplicado | `409 {"error":"Email already registered"}` | ✔ |
| `POST /register` email inválido | `400 details[email]` | ✔ |
| `POST /register` password corta (`123`) | `400 details[password]` | ✔ |
| `POST /register` body `{}` | `400 details[email,password]` | ✔ |
| `POST /register` JSON malformado | `400 {"error":"Malformed JSON body"}` | ✔ |
| `POST /login` válido | `200 {token,expiresIn:"1h"}` | ✔ |
| `POST /login` password errónea | `401 {"error":"Invalid credentials"}` | ✔ |
| `POST /login` usuario inexistente | `401 {"error":"Invalid credentials"}` | ✔ |

### Imágenes

| Petición | Respuesta real | Estado |
|---|---|---|
| `POST /images` sin token | `401 {"error":"Unauthorized"}` | ✔ |
| `POST /images` token inválido | `401` | ✔ |
| `POST /images` sin archivo | `400 {"error":"No image file provided"}` | ✔ |
| `POST /images` `.txt` (MIME no permitido) | `400 {"error":"Unsupported image type","details":["text/plain"]}` | ✔ |
| `POST /images` JPG 120×80 | `201` con `width=120,height=80,mimeType=image/jpeg` | ✔ |
| `POST /images` PNG 64×64 | `201` con metadatos reales | ✔ |
| `POST /images` WEBP 30×30 | `201` con metadatos reales | ✔ |
| `POST /images` archivo 11 MB | `413 {"error":"File too large","details":["10MB max"]}` | ✔ |
| `POST /images` texto como `image/jpeg` | `400 {"error":"Invalid image content"}` | ✔ |
| `POST /images` filename `../../etc/pa$$ ss<>.png` | `201` con filename saneado `"....etcpa ss.png"` | ✔ |
| `GET /images` sin token | `401` | ✔ |
| `GET /images` por defecto | `200` con `pagination{page:1,limit:10,total,totalPages}` | ✔ |
| `GET /images?page=1&limit=2` | `200` con 2 ítems y `totalPages` correcto | ✔ |
| `GET /images?page=0` | `400 details[page] "Too small"` | ✔ |
| `GET /images?limit=999` | `400 details[limit] "Too big … <=50"` | ✔ |
| `GET /images?page=abc` | `400 details[page] "Invalid input"` | ✔ |
| `GET /images?page=999` (fuera de rango) | `200 {data:[], pagination…}` | ✔ |
| `GET /images/:id` propio | `200` detalle con `variants` | ✔ |
| `GET /images/:id` inexistente | `404 {"error":"Image not found"}` | ✔ |
| `GET /images/:id` id malformado | `404` | ✔ |
| `GET /images/:id/file` | `200 image/jpeg`, **byte a byte idéntico** al original | ✔ |
| `GET /images/:id/file?download=1` | `200` + `Content-Disposition: attachment` | ✔ |

### Transformaciones y variantes

| Petición | Respuesta real | Estado |
|---|---|---|
| `POST /transform` `{resize:{width:50}}` | `202 {status:"pending",transformId}` → worker `done` | ✔ |
| `POST /transform` resize+grayscale+format webp | `202` → variante `image/webp` 40×40 | ✔ |
| `POST /transform` `{rotate:90}` | `202` → variante 80×120 (dimensiones intercambiadas) | ✔ |
| `POST /transform` crop válido | `202` → variante 60×40 | ✔ |
| `POST /transform` crop fuera de límites | `202` en API; worker marca log `failed` ("Crop out of bounds") | ✔ (asíncrono) |
| `POST /transform` `{}` | `400 "at least one transformation is required"` | ✔ |
| `POST /transform` `{resize:{fit:"cover"}}` | `400 "resize requires width or height"` | ✔ |
| `POST /transform` `{format:"bmp"}` | `400 "Invalid option…"` | ✔ |
| `POST /transform` `{rotate:45}` | `400 details[rotate] "Invalid input"` | ✔ |
| `POST /transform` sin token | `401` | ✔ |
| `POST /transform` imagen inexistente | `404` | ✔ |
| `GET /variants/:variantId` | `200` binario (JPEG 50×33) | ✔ |
| `GET /variants/:variantId` WEBP | `200 image/webp` | ✔ |
| `GET /variants/deadbeef` | `404 {"error":"Variant not found"}` | ✔ |
| `GET /variants/...` sin token | `401` | ✔ |

### Aislamiento y rutas

| Petición | Respuesta real | Estado |
|---|---|---|
| Usuario B `GET /images` | `200 {data:[], total:0}` | ✔ |
| Usuario B `GET /images/:idDeA` | `404` | ✔ |
| Usuario B `GET /images/:idDeA/file` | `404` | ✔ |
| Ruta inexistente `GET /api/v1/nope` | `404` (HTML por defecto de Express) | ✔ |
| Método no permitido `DELETE /api/v1/images` | `404` (HTML por defecto de Express) | ✔ |
| `GET /docs` | `301` → `/docs/` `200` (Swagger UI) | ✔ |
| `GET /docs/openapi.json` | `200` (OpenAPI 3.1.0) | ✔ |

## Ejemplos de uso

```bash
BASE=http://localhost:3000/api/v1

# 1. Registrar usuario
curl -X POST $BASE/register \
  -H 'Content-Type: application/json' \
  -d '{"email":"demo@example.com","password":"supersecret"}'
# 201 {"id":"...","email":"demo@example.com"}

# 2. Login -> guarda el token
TOKEN=$(curl -s -X POST $BASE/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"demo@example.com","password":"supersecret"}' \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['token'])")

# 3. Subir una imagen
curl -X POST $BASE/images \
  -H "Authorization: Bearer $TOKEN" \
  -F "image=@/ruta/foto.jpg" \
  -F "filename=foto.jpg"
# 201 {"id":"<IMAGE_ID>","width":120,"height":80,...}

# 4. Listar (paginado)
curl "$BASE/images?page=1&limit=10" -H "Authorization: Bearer $TOKEN"

# 5. Detalle con variantes
curl "$BASE/images/<IMAGE_ID>" -H "Authorization: Bearer $TOKEN"

# 6. Descargar el original (adjunto)
curl -OJ "$BASE/images/<IMAGE_ID>/file?download=1" -H "Authorization: Bearer $TOKEN"

# 7. Transformar (cola activa -> 202)
curl -X POST "$BASE/images/<IMAGE_ID>/transform" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"resize":{"width":400,"height":400,"fit":"cover"},"format":"webp"}'
# 202 {"status":"pending","transformId":"..."}

# 8. Tras unos instantes, consulta el detalle para obtener el variantId
curl "$BASE/images/<IMAGE_ID>" -H "Authorization: Bearer $TOKEN"
# variants: {"<VARIANT_ID>": { "url": ".../variants/<VARIANT_ID>", ... }}

# 9. Descargar la variante
curl -o variante.webp "$BASE/images/<IMAGE_ID>/variants/<VARIANT_ID>" \
  -H "Authorization: Bearer $TOKEN"
```

Transformación síncrona (con `QUEUE_ENABLED=false`):

```bash
curl -X POST "$BASE/images/<IMAGE_ID>/transform" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"rotate":90}'
# 201 {"imageId":"...","variantId":"...","url":".../variants/...","width":80,"height":120,"appliedTransforms":["rotate"]}
```

## Tests

```bash
cd backend
# Requiere una base de datos desechable accesible:
export DATABASE_URL="postgresql://postgres:postgres@localhost:5432/image_processing_test?schema=public"
npm test          # node --test -> 26 tests, puerto efímero
```

Cobertura de la suite (`backend/app.test.js`):

- **001 Autenticación**: registro, duplicado (409), password corta (400), login con JWT verificable, credenciales inválidas (401 genérico), endpoint protegido sin token (401).
- **002 Carga**: subida PNG y metadatos reales vía Sharp, ids únicos por subida, ausencia de fichero (400), contenido corrupto (400).
- **004 Detalle**: detalle propio con `variants` vacío, acceso ajeno/inexistente (404), descarga byte a byte, `?download=1` con `Content-Disposition`.
- **005 Listado**: defaults y aislamiento por usuario, orden descendente, paginación con `limit=2`, página fuera de rango, query inválida (400).
- **003 Transformaciones**: variante determinista resize+webp, filtros combinados, crop fuera de límites (400), rotate inválido y payload vacío (400), transformar imagen ajena (404), variante visible en el detalle.

La suite limpia las tablas y la carpeta `uploads-test/` al terminar.

## Documentación y contribución

- Especificación funcional: [`spec/constitution/mission.md`](spec/constitution/mission.md), [`spec/constitution/tech-stack.md`](spec/constitution/tech-stack.md) y las features en [`spec/features/`](spec/features/) (001 autenticación, 002 carga, 003 transformación, 004 detalle, 005 listado).
- Contrato HTTP: OpenAPI 3.1 servido por Swagger UI en `/docs` (fuente en `backend/docs/openapi.json`).
- Arquitectura de código: `routes → controllers → models → prisma`. Los **schemas Zod** son la única fuente de verdad de los contratos de entrada; solo `models/` accede a Prisma; las variables de entorno se leen solo en `config.js`.

No se declara licencia en el repositorio. Las contribuciones se gestionan vía pull requests contra `https://github.com/javierjuanJJ/Image-Processing-Service`.
