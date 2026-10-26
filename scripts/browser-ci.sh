#!/usr/bin/env bash
set -euo pipefail

# The same Actions suites and limits, with exact browser dependencies already
# installed. Avoid slow package mirrors on ephemeral hosted runners.
test "${GITHUB_ACTIONS:-}" = true
test "$(node -p "require('./node_modules/@playwright/test/package.json').version")" = 1.64.1
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
image='mcr.microsoft.com/playwright:v1.64.1-noble@sha256:47b510dd9230bf0b9bfc9b20102241e577ea7a99334ab4c3ca19f19770e9b8ea'
exec docker run --rm --init --ipc=host --network=host \
  --mount "type=bind,source=$root,target=/work" --workdir /work/web \
  --env CI=true --env CARTOLITE_BASE_URL --env PLAYWRIGHT_HTML_OUTPUT_DIR --env CARTOLITE_PROFILE_ROUTES \
  "$image" ./node_modules/.bin/playwright test "$@"
