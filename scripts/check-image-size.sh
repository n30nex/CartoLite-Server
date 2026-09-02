#!/usr/bin/env bash
set -euo pipefail

image="${1:?usage: check-image-size.sh IMAGE}"
limit="${CARTOLITE_IMAGE_SIZE_BUDGET:-52428800}"
size="$(docker image inspect "$image" --format '{{.Size}}')"
[[ "$size" =~ ^[0-9]+$ ]]
echo "$size image bytes (budget $limit)"
test "$size" -le "$limit"
