# CartoLite Server agent instructions

## Purpose

CartoLite Server is one small, worldwide MeshCore traffic map: a Go MQTT/HTTP process, a vanilla TypeScript/MapLibre client, transient Canvas animation, and one atomic checkpoint. Keep it suitable for independent self-hosting.

## Boundaries

- Never expose public keys, observer keys, raw path hex, packet hashes, packet payloads, decoded message text, credentials, or resolver reasons.
- Never infer ambiguous, non-forwarder, missing-coordinate, missing-RF, or distance-gated route hops.
- Keep public API schema v2 synchronized between Go and TypeScript.
- Do not add analytics, accounts, chat, packet history, SQLite, an Android app, country-specific data, or Labs.
- Use synthetic fixtures only. Never commit live broker data, `.env`, checkpoints, captures, or secret files.

## Delivery

- Preserve the scratch, non-root, read-only, capability-free container.
- Supply browser basemap credentials only through a BuildKit secret.
- Keep `REGION_ALLOWLIST` optional and exact when configured.
- Run frontend tests/build, Go tests/vet/race, integration/privacy smoke tests, and `git diff --check` before release.
- Preserve unrelated work and never force-push shared branches.
