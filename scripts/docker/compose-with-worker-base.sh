#!/bin/sh

set -eu

WORKER_BASE_IMAGE="openkeep-worker-base:latest"
WORKER_BASE_DOCKERFILE="docker/worker-base.Dockerfile"
WORKER_BASE_FINGERPRINT=$(shasum -a 256 "$WORKER_BASE_DOCKERFILE" | awk '{print $1}')

CURRENT_FINGERPRINT=""

if docker image inspect "$WORKER_BASE_IMAGE" >/dev/null 2>&1; then
  CURRENT_FINGERPRINT=$(docker image inspect "$WORKER_BASE_IMAGE" --format '{{ index .Config.Labels "org.openkeep.worker-base-fingerprint" }}')
fi

if [ -z "$CURRENT_FINGERPRINT" ] || [ "$CURRENT_FINGERPRINT" != "$WORKER_BASE_FINGERPRINT" ]; then
  if [ -z "$CURRENT_FINGERPRINT" ]; then
    echo "$WORKER_BASE_IMAGE not found locally; building shared OCR base image..."
  else
    echo "$WORKER_BASE_DOCKERFILE changed; rebuilding shared OCR base image..."
  fi

  export WORKER_BASE_FINGERPRINT
  docker compose build worker-base
fi

exec docker compose "$@"
