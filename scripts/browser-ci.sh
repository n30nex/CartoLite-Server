#!/usr/bin/env bash
set -euo pipefail

# The same Actions suites and limits, with exact browser dependencies already
# installed. Avoid slow package mirrors on ephemeral hosted runners.
test "${GITHUB_ACTIONS:-}" = true
test "$(node -p "require('./node_modules/@playwright/test/package.json').version")" = 1.61.1
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
image='mcr.microsoft.com/playwright:v1.61.1-noble@sha256:5b8f294aff9041b7191c34a4bab3ac270157a28774d4b0660e9743297b697e48'
exec docker run --rm --init --ipc=host --network=host \
  --mount "type=bind,source=$root,target=/work" --workdir /work/web \
  --env CI=true --env CARTOLITE_BASE_URL --env PLAYWRIGHT_HTML_OUTPUT_DIR --env CARTOLITE_PROFILE_ROUTES \
  "$image" ./node_modules/.bin/playwright test "$@"
