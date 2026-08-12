#!/usr/bin/env bash
# Run the visual suite inside the same image CI uses.
#
# Text rasterisation depends on the font stack and freetype build, so the same
# page renders differently on a developer laptop and on a CI runner. Ten of the
# forty-four baselines differed between this repo's dev machine and the
# container. Whichever machine generates them decides where the suite passes —
# so the container decides, always, and everyone else compares against that.
#
# The image tag is derived from the installed @playwright/test version rather
# than hardcoded, so bumping the dependency cannot silently leave CI on an
# image whose browser no longer matches.
set -euo pipefail

WEB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_DIR="$(cd "$WEB_DIR/../.." && pwd)"

if ! command -v docker >/dev/null 2>&1; then
  echo "docker is required: the baselines are only reproducible inside the pinned Playwright image." >&2
  exit 1
fi

# Resolved through Node from this package rather than from a fixed
# node_modules path: the repository uses pnpm's hoisted linker for Electron
# Forge, which installs dependencies in the root node_modules instead.
VERSION="$(cd "$WEB_DIR" && node -p "require('@playwright/test/package.json').version")"
IMAGE="mcr.microsoft.com/playwright:v${VERSION}-noble"

# The container workdir is this package, but the hoisted linker installs the
# playwright binary in the root node_modules rather than the package's own.
if [ -x "$WEB_DIR/node_modules/.bin/playwright" ]; then
  PLAYWRIGHT_BIN="./node_modules/.bin/playwright"
else
  PLAYWRIGHT_BIN="../../node_modules/.bin/playwright"
fi

if [ ! -f "$WEB_DIR/dist/index.html" ]; then
  # Through Turbo, not `pnpm --filter`: the web build needs @openkeep/types and
  # @openkeep/sdk built first, and only Turbo knows that. `pnpm --filter` runs
  # the package script alone and fails on a clean checkout.
  echo "no build found — building the web app and its dependencies" >&2
  (cd "$REPO_DIR" && pnpm exec turbo run build --filter=@openkeep/web)
fi

exec docker run --rm \
  -v "$REPO_DIR":/repo \
  -w /repo/apps/web \
  --user "$(id -u):$(id -g)" \
  -e HOME=/tmp \
  -e CI=1 \
  "$IMAGE" \
  "$PLAYWRIGHT_BIN" test "$@"
