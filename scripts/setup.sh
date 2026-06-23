#!/usr/bin/env sh
set -eu

PROJECT_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$PROJECT_ROOT"

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker was not found. Install and start Docker, then run this script again." >&2
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  echo "Docker is installed but the Docker engine is not running." >&2
  exit 1
fi

if [ ! -f .env ]; then
  cp .env.example .env
  echo "Created .env from .env.example."
  echo "Add ANTHROPIC_API_KEY for real extraction and Supabase values for History."
fi

docker compose up -d --build

API_PORT=$(docker compose port app 8000 | head -n 1 | awk -F: '{print $NF}')
N8N_PORT=$(docker compose port n8n 5678 | head -n 1 | awk -F: '{print $NF}')
HEALTH_URL="http://127.0.0.1:${API_PORT}/health"

check_health() {
  if command -v curl >/dev/null 2>&1; then
    curl -fsS "$HEALTH_URL" >/dev/null 2>&1
  elif command -v wget >/dev/null 2>&1; then
    wget -qO- "$HEALTH_URL" >/dev/null 2>&1
  else
    docker compose exec -T app python -c \
      "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=3)" \
      >/dev/null 2>&1
  fi
}

attempt=1
while [ "$attempt" -le 45 ]; do
  if check_health; then
    echo ""
    echo "Aspan Proposal Engine is ready."
    echo "Application: http://127.0.0.1:3000"
    echo "API health:  $HEALTH_URL"
    echo "n8n:         http://127.0.0.1:${N8N_PORT}"
    echo ""
    echo "Stop with: docker compose down"
    exit 0
  fi
  sleep 2
  attempt=$((attempt + 1))
done

docker compose ps
echo "The containers started, but the API did not become healthy. Run 'docker compose logs app'." >&2
exit 1
