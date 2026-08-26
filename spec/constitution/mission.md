# Misión del Servicio

## Nombre

**Image Processing Service** — API de gestión y procesamiento de imágenes tipo Cloudinary.

## Propósito

Proveer un servicio backend autoalojado que permita a aplicaciones cliente:

1. **Registrar y autenticar usuarios** de forma segura mediante JWT.
2. **Subir imágenes** (multipart/form-data) y almacenarlas con metadatos persistidos en PostgreSQL vía Prisma.
3. **Transformar imágenes** on-demand usando `sharp`: resize, crop, rotate, conversión de formato y filtros (`grayscale`, `sepia`), con soporte de procesamiento asíncrono vía RabbitMQ cuando la operación lo requiera.
4. **Consultar el detalle** de una imagen concreta y servirla (binario o URL).
5. **Listar imágenes paginadas** por usuario con parámetros `page` y `limit`.

## Usuarios objetivo

- Desarrolladores frontend/mobile que integran la API vía HTTP REST + JSON.
- Servicios internos que necesitan un pipeline reproducible de transformación de imágenes.

## Principios

| Principio | Implicación |
|---|---|
| **Spec-first** | Ninguna feature se implementa sin su `spec.md`, `plan.md` y `tasks.md` aprobados. |
| **Contratos explícitos** | Toda entrada/salida se valida con Zod; toda la API queda documentada en OpenAPI. |
| **Arquitectura por capas** | `routes → middlewares → controllers → models`; los controllers nunca tocan Prisma directamente. |
| **Seguridad por defecto** | Endpoints protegidos con JWT; cada usuario solo accede a sus propias imágenes. |
| **Testeable** | Tests e2e con `node:test` + `node:assert`, levantando el servidor en puerto dedicado con `before`/`after`. |

## Criterios de éxito (producto)

- Un cliente puede registrarse, loguearse, subir una imagen, transformarla, verla y listarla — todo en una sola sesión HTTP.
- Las transformaciones son deterministas: mismos inputs ⇒ mismo output binario.
- El listado responde en < 200 ms para 10k registros por usuario (índices correctos + paginación obligatoria).

## Fuera de alcance (v1)

- CDN público / firmado de URLs.
- Detección automática de contenido o moderación.
- Facturación y cuotas multi-tenant.
