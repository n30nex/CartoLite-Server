# Visual polish audit — 25 October 2026

Scope: Map, Netgraph, Terminal, Chronoscope, Firehose, Pachinko and Canada's Packet Pond, Firefly Meadow, Mesh Loom and Little Mesh Villages. Worldwide retains its operator-controlled page selection and has no Labs or native Android app.

The baseline is the exact Canada 0.21.0 / Worldwide 0.12.0 release captures, including desktop, phone, short landscape, light/dark and recovery states. Striped land/water backgrounds in these captures are deliberate synthetic fixtures, not a basemap defect. No live broker data is captured. All new builds, tests and browser screenshots run in Actions.

## Findings and patch

| Area | Finding | Change | Verification |
| --- | --- | --- | --- |
| Chronoscope | Its frame extends beyond a 320px phone; camera gestures are not visible in its caption. | Fit Home to the space left by permanent controls; provide mode/input-specific gesture hints. Preserve manually positioned cameras and theme changes. | Project actual frame geometry inside phone/landscape bounds; camera and context-recovery checks. |
| Firehose / Pachinko | The pit disappears behind the landscape dock; Pachinko's sign crowds the phone caption. | Reuse the same Home framing, reserve bucket/dock space, keep manual orbit/zoom, and shorten touch hints. | Portrait, short-landscape and desktop captures with unchanged packet/physics gates. |
| Terminal | A valid but low-contrast custom text colour hides the layers close control and navigation. | Preserve the chosen palette, but keep Display/View/Layers entry points and settings dismissal readable when needed. Explain recovery and bring Reset Terminal display near the preset selector. | Near-identical ink/panel colours, keyboard dismissal/reset, storage preservation and phone bounds. |
| Netgraph | The desktop dock floats 100px up even though it has no map attribution corner to avoid. | Apply the extra corner clearance only to Map/Terminal. | Dock, legend and region controls remain separated on desktop and phones. |
| Labs shell | New navigation has cramped/unspaced labels; the Villages picker text collides with its native arrow. | Give navigation the shared flex layout and comfortable spacing; reserve the select arrow area and ellipsize the current choice. | Every experience, desktop/320px/landscape, keyboard and large text. |
| Labs navigation | Changing the native experiment picker leaves the previous Labs link marked current. | Synchronize the active link with the existing picker without creating another feed/render owner. | Native selection and menu selection, same document and one feed owner. |
| Mesh Loom / Villages | Small, faint lane labels and repetitive plural counts weaken readability. | Improve label contrast/size, honor enlarged text and clamp village labels within the viewport. | Motion/reduced-motion captures; existing scene limits retained. |
| Shared inspection | A long packet's header/close button scrolls out of reach. | Keep packet inspector headers sticky, with a full touch target. | Long confirmed-hop chains, narrow screens and keyboard close. |
| Experimental controls | Sound lacks the icon used on Map/Netgraph; count copy says “1 regions/events/packets.” | Reuse the existing sound icon and correct singular counts. | Shared-menu and single-packet scenarios. |
| Pachinko accessibility | Each fast-changing bucket output implicitly announces every update. | Keep readable counts available while disabling automatic per-packet announcements. | Inspect output semantics; Pause/Resume and connection notices remain accessible. |

Map, Packet Pond and Firefly Meadow retain their established rendering/animation identities. They receive the applicable shared controls and recovery improvements; the audit does not invent a rendering defect merely to change every scene.

## Delivery

Targets: Canada 0.21.1 and Worldwide 0.12.1. The hosted Android views receive these changes; the signed Android 1.1.5 package and certificate remain unchanged.

Run focused visual regressions early in the existing CI pipeline, then every existing build, privacy, topology, scale, recovery and platform-install gate. Keep route meaning, packet/audio timing, reduced motion, saved appearance/layers and performance limits unchanged. Review the actual new captures before promotion. Deploy Canada's exact tested image only after a fresh encrypted backup and isolated restore, followed by public browser checks and at least five healthy minutes. Record initial failures/retries honestly; the prior saved-terrain startup timing remains a separate observed qualification issue unless a root cause is demonstrated.
