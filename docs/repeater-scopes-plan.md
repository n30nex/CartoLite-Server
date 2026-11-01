# Repeater scopes implementation plan

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
