# Tasks — Feature 001 Autenticación

Checklist ejecutable en orden. Cada tarea termina con código compilando (`node --check` o import OK).

## Infraestructura base

- [x] T1. Inicializar proyecto en `backend/`: `npm init -y`, set `"type": "module"`, instalar deps: `express@5 zod @prisma/client prisma jsonwebtoken bcrypt multer sharp cors amqplib swagger-ui-express`.
- [x] T2. Crear `backend/prisma/schema.prisma` con modelo `User` (según constitution §3). Ejecutar `npx prisma generate` (migraciones las lanza quien tenga BD).
- [x] T3. Crear `backend/db/prisma.js` (singleton).
- [x] T4. Crear `backend/config.js` con `port`, `jwtSecret` (fail-fast si falta salvo NODE_ENV=test), `jwtExpiresIn: '1h'`.

## Middlewares

- [x] T5. Crear `backend/middlewares/validate.js`: factory `validate(schema, source='body')` → 400 con `{ error, details }` usando `err.issues`.
- [x] T6. Crear `backend/middlewares/auth.js`: `verifyToken` (Bearer HS256 → `req.user = { sub, email }`; 401 en caso contrario).

## Capa schema

- [x] T7. Crear `backend/schemas/auth.schema.js` con `registerSchema` (email lowercase + password min 8), `loginSchema`, y exports `validateRegister`, `validatePartialRegister`, `validateLogin`, `validatePartialLogin`.

## Capa modelo

- [x] T8. Crear `backend/models/user.model.js`: `create` (hash bcrypt cost 10), `getByEmail`, `getById`.

## Capa controller

- [x] T9. Crear `backend/controllers/auth.controller.js`: `register` (201 `{id,email}`, 409 duplicado) y `login` (200 `{token, expiresIn}`, 401 credenciales inválidas con mensaje único).

## Capa rutas

- [x] T10. Crear `backend/routes/auth.routes.js` montando `validate(...)` antes de cada controller.
- [x] T11. Crear `backend/routes/index.js` montando auth bajo `/api/v1`.

## App y errores

- [x] T12. Crear `backend/app.js`: express.json(), cors con whitelist desde config, rutas index, export de `app` y listen solo si `NODE_ENV !== 'test'`.
- [x] T13. Crear `backend/middlewares/error-handler.js` capturando `err.code === 'P2002'` → 409 y fallback 500 `{ error: 'Internal Server Error' }` (sin stack trace).

## Docs y tests

- [x] T14. Registrar los endpoints `/register` y `/login` en la spec OpenAPI (archivo `docs/openapi.yaml` o similar) + Swagger UI en `/docs`.
- [x] T15. Escribir `backend/app.test.js` con `node:test`: `before` levanta server en puerto dedicado, `after` lo cierra.
- [x] T16. Tests e2e: registro válido 201 / duplicado 409 / password corta 400 / login ok 200+token verificable / login mal 401.
- [x] T17. Marcar feature 001 como `in_progress` → `done` en `spec/constitution/roadmap.md` al completar todo lo anterior.

> ⚠️ Si no hay PostgreSQL disponible en el entorno, NO ejecutar los tests; dejarlos escritos y validar después contra BD real.
