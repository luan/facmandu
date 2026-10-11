# Private factory sprite renderer

`install.sh` builds pinned MIT-licensed [FBSR](https://github.com/demodude4u/Factorio-FBSR), its data wrapper and reporting dependency, then atomically installs the local adapter. Requires Java 21, Python 3, Git and curl. It starts no network service and has no account credentials. Re-run the installer when changing the adapter or its patches; web deployments do not build Java.

Provide the owner's matching Factorio graphics under `~/.local/share/facmandu-renderer/installations/<version>/factorio/data`. These are Wube's game assets, not part of this repository. Beast's 2.1.21 assets were copied from the owner's matching installed game. Do not substitute sprites from another game version.

The app snapshots the enabled mod list and `mod-settings.dat`, reads installed mod archives, and runs a separate headless data export in private cache directories. No save is loaded or modified by rendering. The native version, archives, enabled list and startup settings determine the cache fingerprint; a change during rendering rejects publication. Cold exports continue in the background and report progress through Activity. Retry after the image is ready.

Each atlas includes only the requested entity types and referenced icons. ZIP graphics are read on demand. Jobs are globally serialized, use two Java CPU threads, a 3 GiB heap cap, low CPU priority, timeouts and owned child process groups. Unused prototype graphics are stripped from layout dumps while requested prototypes retain their native data. Upstream patches make grid labels use blueprint coordinates, fix numeric research-name grouping and avoid extracting every icon and entire graphics ZIPs into memory.

`factory_view` captures at most 1,000 entities in an explored 96×96 region through an ephemeral native blueprint. It returns the source game tick, area and blueprint-to-world offset. The model receives the exact PNG served to the authorized browser, with at most two recent images per model request. Images are static factory layouts: terrain, items on belts, players, animations and machine operating state are not represented. Use live factory lookups for those facts. Missing entities, tiles, qualities or render errors fail explicitly; no vanilla sprite is substituted.

Blueprint creation and construction ghost placement remain separate. Rendering has no permission to place entities or start the hosting server.

Prototype icons use the same headless prototype dump and matching graphics. The adapter exports item, fluid, recipe, entity and technology icons into an atomic cache; recipes without explicit icons inherit their native main-product icon. The headless binary does not support `--dump-icon-sprites`. Missing icons are not replaced with generic symbols.
