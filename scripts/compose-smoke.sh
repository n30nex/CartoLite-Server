#!/usr/bin/env bash
set -euo pipefail

image="${1:?candidate image required}"
revision="${2:?candidate revision required}"
previous_image="${3:-$image}"
[[ "$image" =~ ^[a-zA-Z0-9._/:@-]+$ && "$previous_image" =~ ^[a-zA-Z0-9._/:@-]+$ && "$revision" =~ ^[0-9a-f]{40}$ ]]
project=cartolite-install-ci
broker=cartolite-install-mqtt
root="$(pwd)"
scratch="$(mktemp -d "${RUNNER_TEMP:-/tmp}/cartolite-install-XXXXXX")"
output="${COMPOSE_SMOKE_OUTPUT:-artifacts/compose}"
mkdir -p "$output"
compose=(docker compose --env-file "$scratch/install.env" -f "$root/compose.yml" -p "$project")
write_env() {
  cat > "$scratch/install.env" <<EOF
CARTOLITE_IMAGE=$1
CARTOLITE_BIND_ADDR=127.0.0.1
CARTOLITE_PORT=39479
MQTT_BROKER_URL=tcp://$broker:1883
MQTT_TOPIC=meshcore/#
MQTT_CLIENT_ID=cartolite-install-ci
EOF
}
cleanup() {
  docker rm -f "$broker" >/dev/null 2>&1 || true
  "${compose[@]}" down -v >/dev/null 2>&1 || true
  case "$scratch" in "${RUNNER_TEMP:-/tmp}"/cartolite-install-*) rm -rf -- "$scratch" ;; esac
}
trap cleanup EXIT
wait_ready() {
  for _ in $(seq 1 60); do
    if curl --fail --silent http://127.0.0.1:39479/readyz | jq -e '.ready and .mqtt and .checkpoint and .dropped == 0' >/dev/null; then return; fi
    sleep 1
  done
  echo 'Compose instance did not become ready' >&2
  return 1
}
write_env "$previous_image"
"${compose[@]}" up -d --no-build
docker run -d --name "$broker" --network "${project}_default" \
  --mount type=bind,source="$root/testdata/mosquitto.conf",target=/mosquitto/config/mosquitto.conf,readonly \
  eclipse-mosquitto:2.0.22 >/dev/null
wait_ready
bash scripts/publish-fixture.sh "$broker" testdata/synthetic-live.ndjson
# State snapshots refresh once per second. Wait for all eight fixture nodes and
# three confirmed routes before recording the baseline, not a partial snapshot.
for _ in $(seq 1 60); do
  curl --fail --silent http://127.0.0.1:39479/api/state > "$scratch/before.json"
  jq -e '(.nodes | length) == 8 and (.routes | length) == 3' "$scratch/before.json" >/dev/null && break
  sleep 1
done
jq -e '(.nodes | length) == 8 and (.routes | length) == 3' "$scratch/before.json" >/dev/null || { echo 'The complete synthetic fixture was not observed before upgrade' >&2; exit 1; }
# Graceful stop exercises the actual checkpoint/upgrade path, with no replacement fixture after restart.
"${compose[@]}" stop
write_env "$image"
"${compose[@]}" up -d --no-build --force-recreate
wait_ready
curl --fail --silent http://127.0.0.1:39479/api/state > "$scratch/after.json"
curl --fail --silent http://127.0.0.1:39479/api/config | jq -e '. == {schemaVersion:1,basemap:{provider:"openfreemap"}}' >/dev/null || { echo 'Upgraded public map configuration is not key-free OpenFreeMap' >&2; exit 1; }
jq -n --slurpfile before "$scratch/before.json" --slurpfile after "$scratch/after.json" '{before:{nodes:($before[0].nodes|length),routes:($before[0].routes|length)},after:{revision:$after[0].status.gitSha,nodes:($after[0].nodes|length),routes:($after[0].routes|length)}}' > "$output/upgrade-comparison.json"
jq -n -e --arg sha "$revision" --slurpfile before "$scratch/before.json" --slurpfile after "$scratch/after.json" '
  $after[0].status.gitSha == $sha and $after[0].schemaVersion == 2 and
  ($before[0].nodes | map(.id) | sort) == ($after[0].nodes | map(.id) | sort) and
  ($before[0].routes | map(.id) | sort) == ($after[0].routes | map(.id) | sort)
' >/dev/null || { cat "$output/upgrade-comparison.json"; echo 'Checkpoint identity changed across the upgrade' >&2; exit 1; }
container="$("${compose[@]}" ps -q cartolite)"
docker inspect "$container" | jq -e --arg sha "$revision" '.[0] |
  .Config.User == "65532:65532" and .HostConfig.ReadonlyRootfs and
  (.HostConfig.CapDrop | index("ALL")) != null and
  .Config.Labels["org.opencontainers.image.revision"] == $sha and
  .HostConfig.PortBindings["8080/tcp"][0].HostIp == "127.0.0.1"
' >/dev/null || { echo 'Upgraded container identity or hardening failed verification' >&2; exit 1; }
jq --arg image "$image" --arg previous "$previous_image" '{revision:.status.gitSha,version:.status.version,image:$image,previousImage:$previous,nodes:(.nodes|length),routes:(.routes|length),checkpointPreserved:true,keyFreeConfiguration:true,hardeningVerified:true}' "$scratch/after.json" > "$output/verification.json"
echo 'Compose install and checkpoint-preserving upgrade passed.'
