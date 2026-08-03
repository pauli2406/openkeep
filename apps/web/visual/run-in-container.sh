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

VERSION="$(node -p "require('$WEB_DIR/node_modules/@playwright/test/package.json').version")"
IMAGE="mcr.microsoft.com/playwright:v${VERSION}-noble"

if [ ! -f "$WEB_DIR/dist/index.html" ]; then
  echo "no build found — running the web build first" >&2
  (cd "$REPO_DIR" && pnpm --filter @openkeep/web build)
fi

exec docker run --rm \
  -v "$REPO_DIR":/repo \
  -w /repo/apps/web \
  --user "$(id -u):$(id -g)" \
  -e HOME=/tmp \
  -e CI=1 \
  "$IMAGE" \
  ./node_modules/.bin/playwright test "$@"
