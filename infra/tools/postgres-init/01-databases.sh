#!/bin/bash
# Runs once, on the first start of an empty Postgres volume: one database and user per app.
set -euo pipefail
for app in nextcloud twenty listmonk; do
  var="$(echo "$app" | tr '[:lower:]' '[:upper:]')_DB_PASSWORD"
  password="${!var}"
  psql -v ON_ERROR_STOP=1 --username postgres <<SQL
CREATE USER ${app} WITH PASSWORD '${password}';
CREATE DATABASE ${app} OWNER ${app};
SQL
done
