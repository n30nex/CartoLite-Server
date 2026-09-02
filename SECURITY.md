# Security policy

## Supported versions

Only the latest published CartoLite release receives security fixes during the preview period.

## Reporting a vulnerability

Do not open a public issue containing credentials, packet captures, private keys, broker details, live database/checkpoint content, or a working exploit. Use GitHub's **Security > Report a vulnerability** private reporting flow for this repository. Include the affected image digest or Git commit, impact, reproduction steps using synthetic data where possible, and any suggested mitigation.

You should receive an acknowledgement within seven days. No public disclosure timeline is promised until a fix and safe upgrade path exist.

## Public-data boundary

The following are forbidden from every public API, SSE event, log excerpt, screenshot, test artifact, issue, and release asset:

- MQTT credentials or private broker details
- full node or observer public keys
- private keys or channel/group secrets
- raw path bytes, packet hashes, raw payloads, or decoded message text
- resolver debug reasons and live traffic captures
- runtime checkpoints copied from a real deployment

Use only `testdata/synthetic-live.ndjson` when reporting or testing traffic behaviour.
