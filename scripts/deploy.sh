#!/usr/bin/env bash
# Construye y levanta los contenedores con el código que ya está en disco.
# GitHub Actions actualiza el código (git reset) y luego llama a este script.
# A mano:  cd /opt/odaitime && git pull && ./scripts/deploy.sh
set -euo pipefail

cd "$(dirname "$0")/.."

if [ ! -f .env ]; then
  echo "Falta .env — copia .env.example a .env y configúralo." >&2
  exit 1
fi

docker compose build --pull
docker compose up -d --remove-orphans
docker image prune -f >/dev/null

echo "Esperando a que la API esté lista..."
for _ in $(seq 1 30); do
  if docker compose exec -T api python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/api/health/ready')" 2>/dev/null; then
    echo "Despliegue OK"
    docker compose ps
    exit 0
  fi
  sleep 2
done

echo "La API no respondió a tiempo. Últimos logs:" >&2
docker compose logs --tail=50 api >&2
exit 1
