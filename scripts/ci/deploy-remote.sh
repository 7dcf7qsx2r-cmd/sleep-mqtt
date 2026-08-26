#!/usr/bin/env bash
# 目标服务器：与 sleep-api 同机。用 podman-compose / docker compose 起 sleep-mqtt。
set -euo pipefail

REMOTE_DIR="${REMOTE_DIR:?REMOTE_DIR required}"
ENV_FILE="${ENV_FILE:-.env}"

cd "$REMOTE_DIR"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "missing $ENV_FILE in $REMOTE_DIR" >&2
  exit 1
fi

if docker compose version >/dev/null 2>&1; then
  COMPOSE="docker compose"
elif command -v docker-compose >/dev/null 2>&1; then
  COMPOSE="docker-compose"
elif command -v podman-compose >/dev/null 2>&1; then
  COMPOSE="podman-compose"
else
  echo "docker compose / podman-compose not found" >&2
  exit 1
fi

if command -v firewall-cmd >/dev/null 2>&1; then
  firewall-cmd --permanent --add-port=8883/tcp || true
  firewall-cmd --permanent --add-port=8790/tcp || true
  firewall-cmd --reload || true
fi

$COMPOSE up --build -d

for i in 1 2 3 4 5 6 7 8 9 10; do
  if curl -sf "http://127.0.0.1:8790/health" >/dev/null; then
    echo "deploy ok"
    exit 0
  fi
  sleep 3
done

echo "sleep-mqtt health check failed" >&2
$COMPOSE ps || true
exit 1
