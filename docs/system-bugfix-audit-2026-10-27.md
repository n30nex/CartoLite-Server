# System bug-fix audit - 27 October 2026

Baseline: Canada 0.21.4 and Worldwide 0.12.5. This patch repairs data correctness,
bounded ingestion and recovery; it adds no view or visual preset. Builds, tests
and browser artifacts run only in Actions. Current remote issues and pull
requests were empty and both repositories had no open dependency advisories at
inspection; the existing dependency and image scans remain release gates.

## Confirmed defects and corrections

| ID | Impact | Correction and regression coverage |
| --- | --- | --- |
| BF01 | Retained MQTT packets lose their retained flag and old envelope times are replaced by receipt time, causing false live motion, sound, route counts and freshness. | Carry transport/receipt/reported time internally. Dated retained or delayed observations can backfill node metadata at their reported age; they cannot create routes, packet events or active-feed status. Unknown, future or expired retained ages are ignored. Fixtures cover adverts, status, observer-only paths, routes and checkpoint recovery. |
| BF02 | An older observation can replace a newer node name, role or coordinates, and move the last-packet clock backward. | Preserve newer known metadata and monotonic activity time. An old observation may only fill missing coordinates or an unknown role. Keep regional alias and fail-closed RF rules. |
| BF03 | A count-bounded MQTT queue can retain arbitrary decoded JSON trees; its worst-case memory greatly exceeds the container allowance. | Retain only normalized metadata consumed by the engine, bound names, and apply an 8 MiB admission budget for normalized data plus conservative message overhead. Release reservations on rejection and every dequeue, including shutdown. This is not an exact RSS measurement. |
| BF04 | Fractional numeric node types are truncated into valid forwarder roles. | Accept only integral numeric role values; invalid roles remain unknown and cannot manufacture forwarder evidence. |
| BF05 | Pending connects and old subscription completions can survive shutdown/reconnect or report readiness for the wrong connection. | Cancel subscription generations, use actual open-connection state, bound token/write waits, ignore obsolete callbacks and disconnect pending initial retries. Fault fixtures cover cancellation, late SUBACK/loss and repeat cleanup under the race detector. |
| BF06 | Canada's region worker permanently caches a rejected download; stalled workers and disposal can leave promises unresolved. A synchronous worker-startup failure can also escape the map's recovery handler. | Retry failed datasets, abort stalled downloads, expire/recreate silent workers, reject pending work on disposal, and ignore old worker replies. Map cleanup is idempotent. Unit and browser fault tests cover retries, startup exceptions and leaving while loading. Worldwide's coordinate-only resolver is unchanged. |
| BF07 | Regex-based cleanup repeatedly scans malformed hexadecimal input and made the maximum-envelope queue fixture miss its three-second deadline under race instrumentation. | Use one standard-library character pass, preserving decoded bytes and accepted separators. Re-run the original malformed burst with the same deadline, and compare cleanup time/allocations with the legacy regex in Actions. |
| BF08 | Desktop building extrusions can remain in mobile footprint mode after a rapid viewport roundtrip when a canvas resize notification is coalesced. | Reconcile building visibility in the existing debounced viewport handler, even when the final view class matches the starting class. Keep the normal resize case and add a case with canvas notifications suppressed; all existing deadlines remain unchanged. |

The lifecycle, retained-message and region fixes reconcile reviewed pieces of the
older, unfinished reliability branch against current main. Its unrelated clock,
layout and UI changes are not copied, and that branch is preserved.

## Coverage

- MQTT topic/admission rules, timestamp normalization, role/RF evidence, queue
  pressure, reconnect/shutdown and atomic checkpoint behavior.
- HTTP/SSE identity, replay/reset, cursor recovery, privacy and static resources.
- Map/Terminal terrain and region workers; Netgraph layout/filter/follow;
  Chronoscope/Firehose/Pachinko pause, worker ownership and bounded sessions.
- Shared Find, inspectors, themes, sound, keyboard/Back handling and phone docks;
  Canada Labs feed/render ownership and Canada Android navigation/recovery.
- Worldwide provider configuration, optional pages, immutable image promotion,
  native installation and upgrade; Canada deployment and rollback boundaries.

Existing synthetic suites remain the acceptance check for unchanged paths. No
additional confirmed defect from those paths is claimed merely from reading the
code. The earlier intermittent public JavaScript download stall has no proven
application cause; this patch does not change codecs, CDN policy or test limits.
Server-aligned UI-age handling and optional degraded region presentation remain
separate roadmap work, not completed features in this patch.

## Data behavior

The five-minute tolerance applies to the bridge envelope timestamp, not the
radio's internal advert clock. Fresh non-retained observations without a usable
past envelope time use receipt time. A dated observation older than five minutes
is metadata-only. Retained data requires a valid reported past time within the
existing 30-day node-retention window; repeated delivery cannot make it fresh.
Operators with incorrect bridge clocks should correct them rather than relying
on old observations being shown as current radio activity.

## Qualification and release

Run existing frontend/unit/build, Go test/vet/race, synthetic integration/privacy,
full-scale rendering, suspended-session recovery and all-page browser suites.
Retain performance and hardening limits. Canada also runs Android API 26/36;
its signed APK remains unchanged. Worldwide validates anonymous native AMD64 and
ARM64 installation and upgrade from the exact published 0.12.5 digest, alongside
the legacy 0.4.1 migration.

After reviewed passing merges, promote exact tested main digests without
rebuilding. Canada's cutover requires fresh target verification, encrypted
backup, isolated restore, public suites and at least five healthy minutes with
advancing traffic/checkpoints. Release notes and private operations records hold
actual results; source implementation is not deployment evidence.
