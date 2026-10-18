`base-2.1.21.json` was captured by `factory-layout-pack.lua` from a disposable
Factorio 2.1.21 + Space Age save, with force research enabled in that fixture.
It contains only the recipes and tiers used by the circuit-block test.

`logistics-2.1.21.json` comes from the same native fixture, selecting gears,
requester/provider chests, and unlocked normal-quality assembly tiers.

`rocket-chain-2.1.21.json` contains native Beast prototypes and the solved current-tech
Toby plan for 120 rocket fuel/min: acid neutralisation, steam condensation, water
separation, oil cracking, fuel refining and hydrogen disposal. It omits player,
research and runtime context. The whole chain is qualified separately in an
isolated headless world using the matching full mod profile and declared supplies.

`options-2.1.21.json` was captured for a plan created and read in a disposable
copy of Beast. Its ten chosen assemblers produce 900 gears/min. It includes native
Smart Inserters research/settings, requester and storage chest prototypes, and the
frozen planner calculation. No saved world or player inventory is included.

`saved-rocket-belts-2.1.21.json` captures a solved six-stage plan and its live
prototype geometry, researched Smart Inserters reach and AAI red loader tier.
It preserves 61 selected machines, including the planner-selected EARS variant.
That variant requires EARS research and harene-compatible flooring before construction; the fixture tests layout,
not current research availability or live production. The current fluid
service corridors require a larger block than 64×64.
