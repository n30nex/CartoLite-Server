# Theme cohesion audit — 25 October 2026

Scope: Canada and Worldwide Map, Netgraph, Terminal, Chronoscope, Firehose and
Pachinko; Canada's Packet Pond, Firefly Meadow, Mesh Loom and Little Mesh Villages.
The Canada Android app uses the same hosted interface; no native package changes.

## Direction

CartoLite remains a live cartographic instrument: quiet, opaque panels, precise
type, a fine accent edge, and stronger colour reserved for actual traffic. Aurora
is the default teal/frost palette with a warm secondary accent. Glacier, Ember and
Violet offer coordinated alternatives, each with a readable light companion.
Streets retains a warm Paper companion. These are interface choices, independent
of route presets, packet categories and scene brightness.

Inspiration: Beacon's [palette collection](https://github.com/MeshCore-Beacon/beacon-web/tree/811f8430ea7eea0a556068904e71a43e07ac93f7/colour-palettes)
and [theme roles](https://github.com/MeshCore-Beacon/beacon-web/blob/811f8430ea7eea0a556068904e71a43e07ac93f7/public/themes.json),
especially Teal/Copper, Arctic/Frost and Amber. The useful principles are tiered
surfaces, one primary accent, a restrained secondary colour and explicit text
levels. CartoLite's implementation and palettes are authored here; no Beacon
code, font download, component framework or theme-fetching dependency is imported.

## Findings and changes

| Surface | Finding | Resolution |
| --- | --- | --- |
| Shared shell | Several generations of fixed teal/grey values competed with theme overrides. | One CSS token table for panel/field/raised surfaces, borders, text, active/focus and status colours. Page styles reference those roles. |
| Navigation and controls | Focus, selected fills, disabled states and small corner radii varied. | Palette-aware focus/selection, readable disabled copy, common control radii and consistent metadata typography. Existing mobile targets and placement remain. |
| Map | Search, About, sliders and role swatches retained dark-theme colours. | Semantic colours for every affected control; role swatches follow panel brightness. Basemap and route colours stay independent. |
| Netgraph | Sound selects and inspection metadata had fixed dark backgrounds and faint text. | Shared field and text roles, including empty/recovery states and neighbor rows. Geographic layout and camera remain unchanged. |
| Terminal | Its intentional custom palette must not be overwritten by shared themes. | Keep its separate saved profile, fonts and readable recovery editor. Shared structural controls still apply; no duplicate palette picker. |
| Chronoscope | Selected action used an undefined colour token; recent-packet dots followed scene brightness even on contrasting panels. | Use the shared selected fill and panel-specific category swatches. Scene, stack and camera remain intact. |
| Firehose/Pachinko | Shared panels inherited old Netgraph colours; bucket strips used permanent luminous colours on light panels. | Apply the common shell and panel-specific bucket strips. Machine materials, physics and live packet colours retain their meaning. |
| Labs | Header, help, status, captions and Loom legend mixed literal and shared colours. | Same shell tokens and state colours; Loom's panel legend follows the interface. Pond, Meadow, Loom and Villages keep their distinct dark artistic canvases. |
| Preferences | No common accent choice; mixed scene/interface brightness could reduce category contrast. | Safely default older profiles to Aurora; synchronize palette across ordinary views/tabs. UI category colours follow interface brightness; traffic follows scene brightness. |

## Qualification and release

Targets: Canada **0.21.2**, Worldwide **0.12.2**. All builds, browser captures and
automated checks run in Actions. The new suite exercises every page, all four
palettes on desktop, dark/light controls on 320px phones and short landscape,
WebKit, actual rendered text contrast, focus, cross-tab persistence, one feed
owner and Terminal isolation. Existing six route presets, light/dark land/water,
3D, graphics recovery, long sessions, 7,000-route scale and privacy gates remain.

New checks run once in the early visual suite; runtime/input/physics limits are
unchanged. Inspect the resulting synthetic screenshots before release. Publish
the exact qualified images; deploy Canada after a new encrypted backup and
isolated restore, then verify public pages, advancing traffic/checkpoints and
five healthy minutes. Record actual outcomes in the published release notes.
