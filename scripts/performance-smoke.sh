#!/usr/bin/env bash
set -euo pipefail

base_url="${1:-http://127.0.0.1:39476}"
broker_container="${2:-cartolite-mqtt}"
app_container="${3:-cartolite}"
packet_count="${CARTOLITE_LOAD_PACKETS:-1200}"
client_count="${CARTOLITE_LOAD_CLIENTS:-8}"

pids=()
latency_events="$(mktemp)"
container_pid="$(docker inspect "$app_container" --format '{{.State.Pid}}')"
read_write_bytes() {
  local io_file="/proc/$container_pid/io"
  local value
  value="$(awk '/^write_bytes:/ {print $2}' "$io_file" 2>/dev/null || true)"
  if [[ ! "$value" =~ ^[0-9]+$ ]] && command -v sudo >/dev/null 2>&1; then
    value="$(sudo -n awk '/^write_bytes:/ {print $2}' "$io_file")"
  fi
  [[ "$value" =~ ^[0-9]+$ ]]
  printf '%s\n' "$value"
}
write_bytes_before="$(read_write_bytes)"
[[ "$write_bytes_before" =~ ^[0-9]+$ ]]
cleanup() {
  for pid in "${pids[@]:-}"; do kill "$pid" >/dev/null 2>&1 || true; done
  wait >/dev/null 2>&1 || true
  rm -f "$latency_events"
}
trap cleanup EXIT

# Bound the broker-to-public-stream delay before saturating the ingest path.
curl --silent --no-buffer --max-time 10 "$base_url/api/events" >"$latency_events" &
pids+=("$!")
for _ in $(seq 1 100); do
  grep -q '^event: hello' "$latency_events" && break
  sleep 0.02
done
grep -q '^event: hello' "$latency_events"
latency_started="$(date +%s%3N)"
docker exec "$broker_container" mosquitto_pub \
  --host 127.0.0.1 --port 1883 \
  --topic meshcore/SG/CC00000000000000000000000000000000000000000000000000000000000000/packets \
  --message '{"origin":"Synthetic Singapore Observer","raw":"0901AA00AA48656C6C6F","rssi":-72,"snr":7.4}'
for _ in $(seq 1 100); do
  grep -q '^event: packet' "$latency_events" && break
  sleep 0.02
done
grep -q '^event: packet' "$latency_events"
latency_ms=$(( $(date +%s%3N) - latency_started ))
echo "Broker-to-SSE packet latency: ${latency_ms} ms"
test "$latency_ms" -lt 750

for _ in $(seq 1 "$client_count"); do
  curl --silent --no-buffer --max-time 30 "$base_url/api/events" >/dev/null &
  pids+=("$!")
done
sleep 1

started="$(date +%s%N)"
awk -v count="$packet_count" 'BEGIN {
  for (i = 0; i < count; i++)
    print "{\"origin\":\"Synthetic Singapore Observer\",\"raw\":\"0901AA00AA48656C6C6F\",\"rssi\":-72,\"snr\":7.4}"
}' | docker exec --interactive "$broker_container" mosquitto_pub \
  --host 127.0.0.1 --port 1883 \
  --topic meshcore/SG/CC00000000000000000000000000000000000000000000000000000000000000/packets \
  --stdin-line
finished="$(date +%s%N)"

elapsed_ns=$((finished - started))
test "$elapsed_ns" -gt 0
rate=$((packet_count * 1000000000 / elapsed_ns))
echo "$packet_count packets published at ${rate}/s with $client_count SSE clients"
test "$rate" -ge 100

for _ in $(seq 1 20); do
  if curl --fail --silent "$base_url/readyz" | jq -e '.ready == true and .dropped == 0 and .queueDepth == 0' >/dev/null; then
    break
  fi
  sleep 1
done
curl --fail --silent "$base_url/readyz" | jq -e '.ready == true and .dropped == 0 and .queueDepth == 0' >/dev/null
curl --fail --silent "$base_url/api/state" | jq -e '.status.dropped == 0' >/dev/null

rss_kib="$(awk '/^VmRSS:/ {print $2}' "/proc/$container_pid/status")"
[[ "$rss_kib" =~ ^[0-9]+$ ]]
echo "CartoLite RSS after load: ${rss_kib} KiB"
test "$rss_kib" -lt 131072

write_bytes_after="$(read_write_bytes)"
[[ "$write_bytes_after" =~ ^[0-9]+$ ]]
write_bytes_delta=$((write_bytes_after - write_bytes_before))
echo "CartoLite process writes during load: ${write_bytes_delta} bytes"
test "$write_bytes_delta" -ge 0
test "$write_bytes_delta" -lt $((16 * 1024 * 1024))
