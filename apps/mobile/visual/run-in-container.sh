#!/usr/bin/env bash
# Run the mobile visual suite inside the same image CI uses.
#
# Text rasterisation depends on the font stack and the freetype build, so the
# same screen renders differently on a laptop and on a runner. Whichever machine
# generates the baselines decides where the suite passes — so the container
# decides, always, and everyone else compares against that. This mirrors
# `apps/web/visual/run-in-container.sh`, deliberately: two harnesses that behave
# the same are easier to trust than two that each have their own rules.
#
# The bundle is built on the host, not in the container: `expo export` wants the
# workspace's own toolchain, and the export is platform-independent.
set -euo pipefail

MOBILE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_DIR="$(cd "$MOBILE_DIR/../.." && pwd)"

if ! command -v docker >/dev/null 2>&1; then
  echo "docker is required: the baselines are only reproducible inside the pinned Playwright image." >&2
  exit 1
fi

# Resolved through Node from this package rather than from a fixed
# node_modules path: the repository uses pnpm's hoisted linker for Electron
# Forge, which installs dependencies in the root node_modules instead.
VERSION="$(cd "$MOBILE_DIR" && node -p "require('@playwright/test/package.json').version")"
IMAGE="mcr.microsoft.com/playwright:v${VERSION}-noble"

# The container workdir is this package, but the hoisted linker installs the
# playwright binary in the root node_modules rather than the package's own.
if [ -x "$MOBILE_DIR/node_modules/.bin/playwright" ]; then
  PLAYWRIGHT_BIN="./node_modules/.bin/playwright"
else
  PLAYWRIGHT_BIN="../../node_modules/.bin/playwright"
fi

# Always rebuild. A stale bundle would screenshot the previous commit's code and
# pass, which is the one failure mode a visual suite must not have. Set
# MOBILE_VISUAL_SKIP_BUILD=1 when iterating on the suite itself.
if [ "${MOBILE_VISUAL_SKIP_BUILD:-0}" = "1" ] && [ -f "$MOBILE_DIR/visual/dist/index.html" ]; then
  echo "reusing the existing bundle (MOBILE_VISUAL_SKIP_BUILD=1)" >&2
else
  echo "exporting the app for web" >&2
  (cd "$REPO_DIR" && pnpm --filter @openkeep/mobile visual:build)
fi

exec docker run --rm \
  -v "$REPO_DIR":/repo \
  -w /repo/apps/mobile \
  --user "$(id -u):$(id -g)" \
  -e HOME=/tmp \
  -e CI=1 \
  "$IMAGE" \
  "$PLAYWRIGHT_BIN" test "$@"
