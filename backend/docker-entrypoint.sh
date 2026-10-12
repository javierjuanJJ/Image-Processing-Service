#!/bin/sh
# Entrypoint compartido por la API y el worker de transformaciones.
# Si RUN_MIGRATIONS=true aplica las migraciones de Prisma antes de arrancar
# (solo debe activarse en un único servicio para evitar condiciones de carrera).
set -eu

if [ "${RUN_MIGRATIONS:-false}" = "true" ]; then
  echo "[entrypoint] Aplicando migraciones de Prisma..."
  npx prisma migrate deploy
fi

exec "$@"
