#!/usr/bin/env bash
set -euo pipefail

image="${1:?usage: report-image-size.sh IMAGE}"
size="$(docker image inspect "$image" --format '{{.Size}}')"
[[ "$size" =~ ^[0-9]+$ ]]
echo "$size image bytes"
