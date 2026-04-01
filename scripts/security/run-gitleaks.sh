#!/usr/bin/env sh
set -eu

MODE="${1:-git}"
ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)"
CONFIG_FILE="$ROOT_DIR/.gitleaks.toml"
CONTAINER_CONFIG_FILE="/repo/.gitleaks.toml"

if command -v gitleaks >/dev/null 2>&1; then
  GITLEAKS_CMD="gitleaks"
  ACTIVE_CONFIG_FILE="$CONFIG_FILE"
else
  if ! command -v docker >/dev/null 2>&1; then
    echo "gitleaks is not installed and docker is unavailable." >&2
    echo "Install gitleaks locally or use Docker to run the scan." >&2
    exit 1
  fi

  GITLEAKS_CMD="docker run --rm -v $ROOT_DIR:/repo -w /repo zricethezav/gitleaks:latest"
  ACTIVE_CONFIG_FILE="$CONTAINER_CONFIG_FILE"
fi

case "$MODE" in
  git)
    sh -c "$GITLEAKS_CMD git --config '$ACTIVE_CONFIG_FILE' --verbose ."
    ;;
  dir)
    sh -c "$GITLEAKS_CMD dir --config '$ACTIVE_CONFIG_FILE' --verbose ."
    ;;
  *)
    echo "Usage: $0 [git|dir]" >&2
    exit 1
    ;;
esac
