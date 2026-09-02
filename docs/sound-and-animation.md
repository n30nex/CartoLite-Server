# Sound and animation

CartoLite uses native Web Audio with no samples or audio dependency. Aurora, Wood, and Chimes use cached `PeriodicWave` definitions with stable packet, route, hop, and scene variation. Every route hop crossing the current viewport schedules one articulation and one oscillator. Off-screen hops and observer-only traffic stay silent.

Sound is opt-in. A browser gesture is always required to create or resume output, including after mobile sleep. The panel shows On, Off, or Tap to Resume and stores only `{enabled, volume, scene}` locally.

Each live hop follows the exact straight geographic segment used by the historical route layer. Its cue uses a sharp packet core, short glow, restrained sparks, relay handoff, destination shimmer, node wake, and bounded 45-second residue. Hiding Routes does not hide recent live traffic.

Adaptive quality reduces secondary detail and backing resolution during bursts but does not discard visible route hops. Reduced-motion mode uses static cues. The renderer prohibits full-map flashes, additive white saturation, camera-relative route geometry, and effects that survive route expiry.
