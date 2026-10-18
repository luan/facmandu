Interpose engine, vendored from https://gitlab.com/barrystaes/interpose
Commit: 1f7d4b4bf372ceae5a9d8d6e0689ab20ec758427
License: MIT (see LICENSE).

Local patch: fluid routing tracks pending path endpoints and underground pairs;
fluid validation rejects overlapping pieces before network checks. Underground span
checks use indexed real paired spans, preserving usable gaps between separate pairs
and native perpendicular crossings. Same-fluid ports remain traversable; fluid
access and endpoint occupancy are reserved. Search starts use a stable tile order.
Power coverage caches fixed candidate geometry and incremental connectivity without
changing greedy tie order. Blueprint footprint loading also recognizes loaders and ordinary
chests for the logistics-cell power layout. Row spacing is configurable; custom
inserter vectors survive transforms and participate in flow validation. Exact-plan
rows reject inserter-driven machine inflation. Square layouts may split equal
chains only when every saved machine count divides exactly. Native mixed-fluid
belt rows can omit solid outputs and join internal item headers; researched custom
reach can serve outer belts without selecting a second inserter tier.

Only the pure Lua engine is included. Toby supplies force/surface-filtered prototype
data and replaces virtual ports with ordinary belt endpoints. No Interpose mod or
custom port entities are required. Host execution is isolated from the game.

Upgrade by replacing engine/ from a reviewed revision and running the factory-layout
tests plus native throughput benchmarks. Native import is not production validation.
