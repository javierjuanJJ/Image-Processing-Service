# Feature 001 — Autenticación de Usuarios

## Resumen

Permitir el registro de usuarios y la obtención de un JWT mediante login. El token protege todos los endpoints de imágenes de las features 002–005.

## Casos de uso

1. **Como desarrollador cliente**, quiero registrarme con email + contraseña para obtener una cuenta propia.
2. **Como usuario registrado**, quiero loguearme para recibir un JWT válido por `1h`.
3. **Como API**, debo rechazar registros con emails duplicados o contraseñas débiles.
4. **Como middleware**, debo validar el JWT en cada endpoint protegido e inyectar `{ sub, email }` en `req.user`.

## Contratos OpenAPI

### POST /api/v1/register

```yaml
paths:
  /api/v1/register:
    post:
      summary: Registra un nuevo usuario
      tags: [Auth]
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [email, password]
              properties:
                email:
                  type: string
                  format: email
                  example: ana@example.com
                password:
                  type: string
                  format: password
                  minLength: 8
                  example: S3gura!2026
      responses:
        '201':
          description: Usuario creado
          content:
            application/json:
              schema:
                type: object
                properties:
                  id: { type: string, format: uuid }
                  email: { type: string }
        '400':
          description: Payload inválido (Zod)
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Error'
              example: { error: 'Invalid request', details: [{ path: ['password'], message: 'min 8 chars' }] }
        '409':
          description: Email ya registrado
          content:
            application/json:
              example: { error: 'Email already registered' }
```

### POST /api/v1/login

```yaml
  /api/v1/login:
    post:
      summary: Autentica un usuario y devuelve un JWT
      tags: [Auth]
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [email, password]
              properties:
                email: { type: string, format: email }
                password: { type: string, format: password }
      responses:
        '200':
          description: Token emitido
          content:
            application/json:
              schema:
                type: object
                properties:
                  token:
                    type: string
                    example: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
                  expiresIn: { type: string, example: '1h' }
        '400': { $ref: '#/components/responses/BadRequest' }
        '401':
          description: Credenciales inválidas
          content:
            application/json:
              example: { error: 'Invalid credentials' }
```

### Seguridad global (aplica a features 002–005)

```yaml
components:
  securitySchemes:
    bearerAuth:
      type: http
      scheme: bearer
      bearerFormat: JWT
  responses:
    Unauthorized:
      description: Token ausente/inválido/expirado
      content:
        application/json:
          example: { error: 'Unauthorized' }
```

Header requerido en endpoints protegidos: `Authorization: Bearer <token>`.

## Reglas de negocio

- `password` mínimo **8 caracteres**; se almacena como hash (bcrypt cost ≥ 10). Nunca en texto plano ni en respuestas.
- `email` normalizado a minúsculas antes de guardar/comparar.
- El registro NO emite token automáticamente (el cliente debe hacer login explícito) — decisión v1 para mantener contratos simples.
- Mensaje de error de login idéntico para "usuario no existe" y "contraseña incorrecta" (no filtrar existencia de cuentas).
- JWT: algoritmo HS256, payload `{ sub: userId, email }`, expiración desde `config.jwtExpiresIn`.

## Criterios de aceptación

- [ ] `POST /register` con payload válido responde `201` con `{ id, email }` y sin campo `password`.
- [ ] Registro duplicado ⇒ `409 { error: 'Email already registered' }`.
- [ ] Payload inválido (email mal formado, password < 8) ⇒ `400` con detalles de Zod.
- [ ] `POST /login` con credenciales correctas ⇒ `200 { token, expiresIn }`; el token verifica contra `config.jwtSecret`.
- [ ] Login con credenciales incorrectas ⇒ `401 { error: 'Invalid credentials' }` (mismo mensaje en ambos casos).
- [ ] Middleware `verifyToken`: sin header ⇒ `401`; token manipulado/expirado ⇒ `401`; token válido ⇒ `req.user = { sub, email }` y pasa al siguiente handler.
- [ ] Tests e2e cubren los 6 escenarios anteriores en `app.test.js`.
