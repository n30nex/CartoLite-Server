#!/usr/bin/env bash
set -euo pipefail

version="$(tr -d '\r\n' < VERSION)"
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]
image="ghcr.io/n30nex/cartolite-server:${version}"
jq -e --arg version "$version" '.version == $version' web/package.json >/dev/null
jq -e --arg version "$version" '.version == $version and .packages[""].version == $version' web/package-lock.json >/dev/null
grep -Fxq "CARTOLITE_IMAGE=${image}" .env.example
grep -Fxq "    image: \${CARTOLITE_IMAGE:-${image}}" compose.yml
echo "Installer defaults match ${version}"
