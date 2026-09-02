#!/usr/bin/env bash
set -euo pipefail

base_url="${1:-http://127.0.0.1:39476}"
artifact_dir="${2:-artifacts/integration}"
broker_container="${3:-cartolite-mqtt}"
mkdir -p "$artifact_dir"

curl --fail --silent --show-error "$base_url/healthz" | tee "$artifact_dir/health.json" | jq -e . >/dev/null
curl --fail --silent --show-error "$base_url/readyz" | tee "$artifact_dir/ready.json" | jq -e . >/dev/null
curl --fail --silent --show-error --dump-header "$artifact_dir/headers.txt" --output "$artifact_dir/index.html" "$base_url/"
grep -Eiq '^Strict-Transport-Security: max-age=31536000[[:space:]]*$' "$artifact_dir/headers.txt"
grep -Eiq '^Permissions-Policy: .*geolocation=\(\).*usb=\(\)' "$artifact_dir/headers.txt"
for public_asset in favicon.svg robots.txt site.webmanifest social-card.svg; do
  curl --fail --silent --show-error "$base_url/$public_asset" > "$artifact_dir/$public_asset"
done
missing_code="$(curl --silent --output /dev/null --write-out '%{http_code}' "$base_url/missing-asset.svg")"
test "$missing_code" = 404

for _ in $(seq 1 60); do
  curl --fail --silent --show-error "$base_url/api/state" > "$artifact_dir/state.json"
  if jq -e '.schemaVersion == 2 and (.nodes | length) >= 2' "$artifact_dir/state.json" >/dev/null; then
    break
  fi
  sleep 1
done
jq -e '.schemaVersion == 2 and (.nodes | length) >= 2 and (.status.dropped // 0) == 0' "$artifact_dir/state.json" >/dev/null

curl --no-buffer --silent --show-error --max-time 10 \
  -H 'Accept: text/event-stream' "$base_url/api/events" > "$artifact_dir/events.txt" &
events_pid="$!"
cleanup() { kill "$events_pid" >/dev/null 2>&1 || true; }
trap cleanup EXIT
for _ in $(seq 1 100); do
  grep -q '^event: hello' "$artifact_dir/events.txt" && break
  sleep 0.02
done
grep -q '^event: hello' "$artifact_dir/events.txt"
docker exec "$broker_container" mosquitto_pub \
  --host 127.0.0.1 --port 1883 \
  --topic meshcore/SG/CC00000000000000000000000000000000000000000000000000000000000000/packets \
  --message '{"origin":"Synthetic Singapore Observer","raw":"0901AA00AA48656C6C6F","rssi":-72,"snr":7.4}'
for _ in $(seq 1 100); do
  grep -q '^event: packet' "$artifact_dir/events.txt" && break
  sleep 0.02
done
grep -q '^event: packet' "$artifact_dir/events.txt"
kill "$events_pid" >/dev/null 2>&1 || true
wait "$events_pid" >/dev/null 2>&1 || true
trap - EXIT

for _ in $(seq 1 60); do
  curl --fail --silent --show-error "$base_url/api/state" > "$artifact_dir/state.json"
  if jq -e '(.routes | length) >= 1' "$artifact_dir/state.json" >/dev/null; then
    break
  fi
  sleep 0.1
done
jq -e '
  (.nodes | map(.id)) as $node_ids |
  (.routes | length) >= 1 and
  (.routes | all(
    . as $route |
    (.fromId | type == "string" and length > 0) and
    (.toId | type == "string" and length > 0) and
    ($node_ids | index($route.fromId)) != null and
    ($node_ids | index($route.toId)) != null and
    (has("from") | not) and (has("to") | not) and
    (.lastKind as $kind | ["Advert", "Trace", "Text", "ACK", "Control", "Other"] | index($kind)) != null and
    (.traffic | type == "number" and . >= 0 and . <= 64)
  ))
' "$artifact_dir/state.json" >/dev/null
grep -q '"fromId"' "$artifact_dir/events.txt"
if grep -Eq '"(from|to)":' "$artifact_dir/events.txt"; then
  echo "packet event contains duplicated endpoint objects" >&2
  exit 1
fi

if grep -Eiq '(^|["_])(public.?key|observer.?key|packet.?hash|raw.?path|raw.?payload|payload|decoded|message|resolver.?reason|mqtt.?password)(["_:]|$)' \
  "$artifact_dir/state.json" "$artifact_dir/events.txt"; then
  echo "forbidden public field detected" >&2
  exit 1
fi

for private_path in /api/v1/live/state /api/v1/debug/state /api/v1/nodes /api/v1/packets /ws; do
  code="$(curl --silent --output /dev/null --write-out '%{http_code}' "$base_url$private_path")"
  [[ "$code" == 404 || "$code" == 405 ]]
done
