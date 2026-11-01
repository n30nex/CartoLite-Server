# Repeater scopes implementation plan

## Delivered 1 November 2026

[Worldwide 0.13.0](https://github.com/n30nex/CartoLite-Server/releases/tag/v0.13.0)
was published from `41d7824a75d8e4e0ec47736e54af8ac2e88cb8a3`.
[Exact-main qualification](https://github.com/n30nex/CartoLite-Server/actions/runs/41278051302)
passed 511 browser checks with no failed/flaky results, plus Go/vet/race,
frontend, privacy/security, native platform installation and checkpoint upgrades.
Anonymous pulls passed on AMD64 and ARM64. The existing performance limits and
all 7,000 retained routes remained required; scope-enabled scale cases were added.

[Promotion](https://github.com/n30nex/CartoLite-Server/actions/runs/41280913520)
reused the tested image without rebuilding:
`ghcr.io/n30nex/cartolite-server@sha256:6002785f5a4c757dd7da1d4d56ef318a944816a23087051cbc0f1b9d60bffd62`.
All 42 release assets, canonical checksums, image aliases and source provenance
were checked. Screenshots are unmodified synthetic Actions captures. No community
server deployment or physical-device result is claimed.

The plan below records the implemented boundaries. Native scope coverage starts
with new MQTT evidence; no complete-history or unique-RF-transmission claim is made.

## Evidence contract

Count accepted live MQTT FLOOD and TRANSPORT_FLOOD hearing reports only. Exclude
retained/delayed traffic, DIRECT/preloaded paths and TRACE signal bytes. Resolve
full private identities without choosing among prefix collisions, accept only
known repeaters and count each identity once per path. Ordinary unscoped flood is
`*`; unresolved scoped traffic is `?`. These are observer reports, not unique RF
transmissions. Membership never attributes a scope to an edge.

Preserve case-sensitive names, reported lists, explicit empty lists, default
scope and receiver-heard evidence separately. Configuration never contributes a
repeat vote. Scope colors require a unique largest observed repeat count; ties,
missing evidence, dominant unresolved counts and palette overflow stay neutral.
Windows use the current partial UTC hour plus the preceding 0, 5 or 23 buckets.
No backfill or complete-history claim is made for unsupported old checkpoints.

## Small implementation

1. Add bounded, expiring native aggregates and report metadata inside the current
   engine and atomic checkpoint. A policy marker rejects foreign/provider scope
   state on MQTT-only restoration while preserving existing nodes/routes.
2. Serve a cached batch scope summary separately from traffic API v2. Refresh
   evidence at bounded cadence, never per packet/frame or through N+1 requests.
3. Add Repeater scopes, 1h/6h/24h, highlight/isolate, a visible-area legend and
   compact inspector evidence. Persist settings and copy/restore deep links.
   Filter before clustering; sum repeat reports, not membership counts. Use
   ordinary scopeNames/scopeRepeatValues arrays in worker-bound GeoJSON and at
   most 64 colored names. Preserve camera, selection, Follow, packet/audio timing,
   style recovery, reduced motion, mobile bounds and world-copy geometry.
4. Qualify synthetic parser, collision, serializer, window, recovery, privacy and
   dense-scene scenarios in the existing GitHub Actions pipeline. Keep all current
   rendering budgets. Promote only an exact tested main-image digest.

Beacon is a behavioral reference. Its AGPL modules and database/UI stack are not
copied into this MIT project; the implementation uses existing CartoLite helpers
and standard libraries. The optional cross-observer sample metric is not needed
for the map's hearing-report counts and is not represented as RF transmissions.

## Worldwide policy and delivery

Target 0.13.0. All scope evidence and candidate names come from this installation's
own MQTT data. There is no MeshMapper client, key, Canadian catalogue, Beacon API
or geographic name inference. Test fresh startup and checkpoint import with this
policy, including rejection of provider/Canada scope extensions.

Keep key-free maps, optional pages, native AMD64/ARM64 install and checkpoint
upgrade checks. Publish the tested image and installation assets through the
existing release workflow. No community deployment host is assumed.
