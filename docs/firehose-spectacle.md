# Firehose: motion and luminous packets

The first release's full pile kept thousands of rigid bodies awake. Read-only
desktop counters showed about 54 ms per physics step versus 0.4 ms drawing,
alongside zero sleeping bodies. Lowering graphics detail could not fix that.

This patch uses a dedicated particle solver in the existing worker: fixed-step
gravity, sphere contacts found through a bounded spatial hash, maximum-length
constraints for confirmed links, and collisions against the rotating box.
Settled particles sleep and support contacts. Impacts, stretched links and tilt
wake them; staggered support probes prevent unsupported particles floating after
their neighbours leave. Whole packet graphs and the existing capacity limits
remain intact. Angular rigid-body calculations add no visible information to dots
and are removed, along with the unused WASM dependency and its CSP exception.

The renderer uses luminous points at every graphics setting, short velocity
trails, brief pulses on newly observed links, an illuminated funnel and restrained
floor-contact rings. It retains GPU batching, reuses buffers and effect slots,
and interpolates using observed snapshot intervals instead of assuming 30 Hz.
Hit testing uses the same interpolated positions. Motion settings control the
decoration; no effect creates packets or schedules extra sound. Paused/hidden
intervals still do not refill the pile.

Actions verifies contacts, sleeping, tilt/wake, overflow, topology and clearing,
plus the existing browser, privacy and release checks. The dense browser fixture
also requires physics step p95 below 25 ms while keeping the existing input-delay
and capacity gates. Comparable synthetic screenshots come from Actions.
