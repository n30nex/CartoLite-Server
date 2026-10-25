# Packet arcade and 3D sculpture

Targets: Canada 0.21.0, Worldwide 0.12.0, and Canada Android 1.1.5 if the new route requires its native allowlist/start-view update.

## 1. Reliability, navigation and materials

- Investigate the deployed 0.20.1 failures: Firehose input stalls above 300 ms and the saved-terrain readiness timeout. Canada remains on qualified 0.20.0 until the replacement passes public checks.
- Prewarm graphics programs and material uploads before accepting live packets, including context recovery. Keep readiness honest and preserve existing performance limits.
- Use generated metal matcap and enamel textures for machine surfaces. Keep traffic colors independent of decoration; batch geometry and keep effects bounded.
- Replace the flat view row with icon-labelled Map, Netgraph and Terminal links, an Experimental list (Chronoscope, Firehose, Pachinko), and Canada's Labs list. Keep the compact phone picker, keyboard/Escape/Back behavior, focus restoration and single menu/feed ownership.
- Worldwide lists only operator-enabled optional pages; Map and Netgraph remain the defaults. Add `pachinko` to `EXTRA_PAGES` without changing existing selections.

## 2. Pachinko and Firehose

- Add `/pachinko/`, using one colored dot per fresh sanitized packet and no route links.
- Six type lanes feed labelled Advert, Trace, Text, ACK, Control and Other buckets. Peg contacts, pile collisions and overflow into the drain are illustrative physics, not radio paths or signal measurements.
- Reuse the bounded worker and batched GPU drawing where appropriate. Provide camera controls, pause, inspection, sound controls, clear and an animated drain action. Start empty and never refill from hidden/replayed traffic.
- Improve Firehose's material shading, source/drain lighting, clarity and smoothness while preserving confirmed chains, tilt and pouring.

## 3. Chronoscope sculpture

- Add a real 3D orbit/pan/zoom camera with a stable initial isometric view and Home reset. Preserve recognizable geographic groups, selection, appearance and explicit Follow behavior.
- Let observed packet shapes descend and settle into a growing bottom sculpture. Bound retained events/segments and disclose caps. The sculpture is session-local; no backend history or new public traffic fields.
- Keep recent-time Flat/Slice inspection, freeze and clear. Keep a usable fallback when graphics are unavailable. Improve source/travel/arrival emphasis without changing audio or packet timing.

## 4. Qualification and delivery

- Builds, tests and browser artifacts run only in GitHub Actions, with synthetic fixtures. No workstation builds or browser test generation.
- Cover default/subset/all operator page choices, grouped navigation on desktop/320px/touch/keyboard, native Canada navigation, both themes, graphics loss, missing textures, hidden/resumed tabs, clear/drain and bounded dense scenes.
- Validate Pachinko type conservation and overflow; Chronoscope projection/picking/camera, stacking, caps and freeze behavior; Firehose's unchanged input/physics and topology gates.
- Publish exact tested AMD64/ARM64 Worldwide images without rebuilding. Preserve the original Android certificate if publishing an APK.
- Deploy Canada only after fresh target verification, encrypted backup and isolated restore. Require public browser acceptance and at least five healthy minutes with advancing traffic/checkpoints; roll back on failed acceptance.
- Publish current screenshots, provenance, checksums, release notes and product links; update private Ops records while preserving concurrent Solar work.
