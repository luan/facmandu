Interpose engine, vendored from https://gitlab.com/barrystaes/interpose
Commit: 1f7d4b4bf372ceae5a9d8d6e0689ab20ec758427
License: MIT (see LICENSE).

Local patch: fluid routing tracks pending path endpoints and underground pairs;
fluid validation rejects overlapping pieces before network checks. Underground span
checks use indexed axis extrema instead of comparing every endpoint pair and allow
native perpendicular underground crossings. Search starts use a stable tile order.
Power coverage caches fixed candidate geometry and incremental connectivity without
changing greedy tie order. Blueprint footprint loading also recognizes ordinary
chests for the logistics-cell power layout.

Only the pure Lua engine is included. Toby supplies force/surface-filtered prototype
data and replaces virtual ports with ordinary belt endpoints. No Interpose mod or
custom port entities are required. Host execution is isolated from the game.

Upgrade by replacing engine/ from a reviewed revision and running the factory-layout
tests plus native throughput benchmarks. Native import is not production validation.
