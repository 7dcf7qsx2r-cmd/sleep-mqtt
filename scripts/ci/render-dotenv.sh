#!/usr/bin/env bash
# GitHub Actions 渲染生产 .env
set -euo pipefail

required=(ADMIN_TOKEN BRIDGE_SECRET SEED_DEVICE_SECRET)
for k in "${required[@]}"; do
  if [[ -z "${!k:-}" ]]; then
    echo "missing required env: $k" >&2
    exit 1
  fi
done

cat <<EOF
NODE_ENV=production
EMBED_BROKER=1
PORT=8790
MQTT_LISTEN_PORT=1883
DATA_DIR=/app/data
ADMIN_TOKEN=${ADMIN_TOKEN}
BRIDGE_SECRET=${BRIDGE_SECRET}
MQTT_PUBLIC_HOST=${MQTT_PUBLIC_HOST:-119.29.148.43}
MQTT_PUBLIC_PORT=1883
SEED_PRODUCT_KEY=${SEED_PRODUCT_KEY:-xiaomian_mvp}
SEED_DEVICE_SN=${SEED_DEVICE_SN:-SNDEMO0001}
SEED_DEVICE_SECRET=${SEED_DEVICE_SECRET}
EOF
