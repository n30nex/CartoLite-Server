# Packet sound voices

CartoLite provides **30 synthesized, instrument-inspired sound voices** using native Web Audio, with no samples, downloads, or audio dependency. Choose **Sound → Voice** on Map or Netgraph. The native selector groups the library by character and the panel explains the selected sound.

| Group | Voices |
|---|---|
| Originals | Aurora, Wood, Chimes |
| Keys & mallets | Felt Piano, Electric Piano, Marimba, Kalimba, Vibraphone, Celesta, Music Box |
| Strings & bells | Harp, Koto, Dulcimer, Glass Bells, Temple Bells, Steel Pan |
| Synths & air | Soft Organ, Reed, Flute, Choir, Velvet Pad, Analog Pluck, 8-bit |
| Signals & percussion | Sonar, Radar, Bubble, Droplet, Soft Kick, Tom, Rim Click |

Aurora, Wood, and Chimes retain their existing profiles and saved identifiers. The new voices vary cached harmonic tables, attack/sustain/release, note-length caps, register, pitch bends, filter shape/sweep, and a dry or lightly echoed finish. These are synthesized interpretations rather than sampled acoustic instruments or speech. Packet kind still controls the musical scale, and each scene keeps deterministic packet/route/hop variation.

Selecting a voice never enables sound or plays an unsolicited preview. The existing enabled state and 0–100% volume remain local to the browser and are shared across views. All voices keep one oscillator per visible route hop, the same hop starts and stereo positioning, pause/hidden-tab muting, mobile gesture unlock, and silence for off-screen or observer-only activity.

The catalog is shared by synthesis and the picker. GitHub Actions validates every voice with native `OfflineAudioContext` rendering: finite, audible, distinct output; conservative peaks; one oscillator; and a silent tail after completion. Synthetic browser journeys cover saved choices and the visible controls. These checks do not claim physical phone-speaker or headphone testing.
