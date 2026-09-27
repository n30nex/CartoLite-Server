# Cinematic overhaul delivery

Target Canada 0.15.0, Worldwide 0.6.0 and Canada Android 1.1.0.

- [x] Shared preferences, compact dock, layer combinations and accessibility
- [x] Shared GPU live effects with Canvas fallback; terrain and density refinement
- [x] Scoped Follow, Netgraph focus, selection continuity and Canada Labs
- [ ] Synthetic visual, privacy, performance and image gates in Actions
- [ ] Exact-artifact releases, Canada backup/restore/deployment, physical APK acceptance

No public API changes. Existing topology and packet/audio clocks remain authoritative.
Builds, tests and browser artifacts run in GitHub Actions only.

The app supplies compact MapLibre canvas/gesture/attribution styling rather than shipping unused provider-control icons. The existing total byte limits remain unchanged.

Implementation checkmarks indicate code completion. Release verification remains open until the final commit passes Actions and runtime acceptance.
