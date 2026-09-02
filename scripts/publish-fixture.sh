#!/usr/bin/env bash
set -euo pipefail

container="${1:-cartolite-mqtt}"
fixture="${2:-testdata/synthetic-live.ndjson}"
delay="${FIXTURE_DELAY_SECONDS:-0.02}"

test -s "$fixture"
while IFS= read -r line || [[ -n "$line" ]]; do
  [[ -z "$line" ]] && continue
  topic="$(jq -er '.topic | select(startswith("meshcore/"))' <<<"$line")"
  payload="$(jq -ec '.payload | objects' <<<"$line")"
  docker exec "$container" mosquitto_pub \
    --host 127.0.0.1 --port 1883 --topic "$topic" --message "$payload"
  sleep "$delay"
done < "$fixture"
