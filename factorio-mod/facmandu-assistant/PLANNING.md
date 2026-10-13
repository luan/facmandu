# Toby production planning

Toby will contain a fork of Factory Planner, with its planning UI and calculation engines available without AI, Facmandu, RCON, or a network connection. Helmod-style input targets and machine constraints extend that same planner. When an agent is connected, it reads and edits the same plans through validated operations.

The agent harness will use Factory Planner's UI components and interaction patterns. Planning, conversation, activity, blueprints, and the companion belong to one Toby interface. Manual planning remains available when the agent disconnects.

## Source and current boundary

`planner/` starts from the installed Factory Planner 2.1.18 distribution, verified as 184 matching files before adaptation. Toby 0.0.7 loads and packages the fork. Imports, GUI and prototype names, remote interfaces, asset paths, lifecycle registration and planner storage are namespaced for coexistence. The native simplex engine now supports exact or maximum input supply and a nominated output to maximize.

- Upstream: https://github.com/ClaudeMetz/FactoryPlanner
- Release: `v2.1.18`, commit `f4cc3fea9fd6badd1b073214bc7d0ba7a0723461`.
- Distribution SHA-256: `8524361ac3a2a6790610059fd1a3ab7df2a77b79333a475c548c99ae9225f9b7`.
- Factory Planner: MIT, retained in `planner/LICENSE.md`.
- Translations: Unlicense, retained in `planner/locale/LICENSE.md`.
- Bundled flib graphics: MIT, retained in `planner/graphics/flib/LICENSE`.

Preserve these notices in the released Toby archive. Attribute any subsequently copied Helmod code separately. Factory Planner 2.1.18 requires Factorio 2.1.20 or later; the combined mod must retain that requirement.

## Features to retain and extend

| Capability | Factory Planner base | Toby change |
| --- | --- | --- |
| Products defined by rate, belts, or machine count | Already present | Retain existing controls and calculations |
| Multiple products and byproducts | Already present | Keep explicit targets and surplus visible |
| Recipe and machine choices, modules, beacons, quality | Already present | Use the same controls for manual and agent edits |
| Fluids with temperature, surface conditions, research effects | Already present | Preserve these identities and checks in tools |
| Nested floors and per-floor solver selection | Already present | Reuse for linked production blocks |
| Sequential, Gaussian, and simplex calculations | Already present | Extend the existing engines rather than add another solver |
| Available input supply | Simplex has a limited-ingredients TODO | Implemented exact or maximum input rates |
| Counts for a specific recipe line | Existing machine goals resolve through a product's first matching line | Allow explicitly selecting the constrained line |
| Agent workspace | Existing Toby panel and remote updates | Rewrite using the planner's components and event system |

Additional Helmod capabilities should be added against concrete examples. Do not silently replace supported mining, power, fuel, spoilage, or modded mechanics with ordinary crafting approximations.

## Planning controls

Keep Factory Planner's district, factory, floor, and production table. Add an Inputs section alongside Products. A player chooses an item or fluid through the native picker, enters a rate or belt amount, and chooses **Use exactly** or **Use at most**. Show actual consumption and unused supply separately.

Output-led planning retains the existing target controls. Input-led planning chooses the output to maximize and constrains available inputs; it does not invent imports to cover a shortage. Machine-led planning selects a recipe line, machine, quality, and count. **Exactly** fixes operating capacity; **At most** permits unused capacity. Display fractional operating counts separately from the whole machines needed to build.

Inputs, outputs, and machine constraints may be combined. A selected maximum-output goal is explicit; several competing outputs require a player choice rather than a hidden weighting. Infeasible constraints show the unmet conditions. Missing recipe choices, unavailable machines, and unbounded optimization remain distinct results.

Reuse picker dialogs, module controls, production rows, tooltips, preferences, keyboard actions, and focus behavior in the agent harness. Chat and Activity occupy their own workspace views; the planner keeps its full production table rather than being squeezed into the current narrow side panel. Blueprint controls and companion controls remain available in that workspace. Disconnection affects agent requests, not saved plans or manual tools.

## Shared calculation path

`backend/data/FactoryItem.lua` already supports amount, belt, and machine definitions. `backend/calculation/solver.lua` creates the solver data and resolves machine requirements. `backend/calculation/simplex_engine.lua` contains the missing limited-ingredients path. Extend these shared paths and their existing serialization.

Apply a material supply constraint to its total external import. In particular, do not add a constrained input variable while leaving an unconstrained import variable for the same material: that would bypass the supply limit. Preserve item type, fluid temperature, and quality throughout lookup and balance calculations.

Exact input and line-count constraints become equalities. Supply and capacity limits become inequalities. Input-led maximization uses the nominated output's net export as its objective. Reuse the existing tableau, factorization, and solver cache. Clear incompatible cached bases when constraint structure changes.

Keep plan edits independent of world construction. Predicted rates and machine counts are solver results; measured production, delivered output, and built entities remain separate observations.

## One mod runtime

Both current entry points register lifecycle and GUI handlers, and both use `storage.players`. Loading their control files sequentially would replace handlers and mix incompatible player records.

Retain Factory Planner's existing event listener system and Toby callbacks, registering both through `events.lua`. Each subsystem keeps replacement and cancellation semantics within its own scope; shared native callbacks dispatch to both. Adapt Toby's existing periodic companion work and the planner's scheduled searches without replacing either subscription. Preserve Factorio's restrictions on storage mutation during `on_load`.

Keep existing Toby state at its current storage paths and put planner state under `storage.planner`. Preserve current drafts, chat selections, blueprint references, and companion ownership through an explicit migration. Remove or adapt upstream whole-storage reset paths before activation. Runtime globals, metatables, remote interfaces, module imports, sprites, styles, shortcuts, commands, and data-stage names need a coexistence audit; asset paths must resolve inside Toby's archive.

The upstream `info.json`, settings, locale, and data entry points are source material. Merge their required content into Toby's corresponding entry points; a nested mod directory is not a separately loaded mod. Package all runtime modules, styles, locales, graphics, and license notices in one Toby archive. The installed external Factory Planner adapter becomes a compatibility route, not a runtime dependency of the built-in planner.

Keep existing external Factory Planner and Helmod plans intact. Offer explicit import through supported exports, retain the original, and report unsupported fields. A namespace audit determines whether the fork can coexist with external Factory Planner during migration; do not silently disable or overwrite it.

## Agent operations

Expose a capability query plus bounded operations to list accessible plans, read a plan, calculate a temporary proposal, create a saved plan, and apply an edit. Reuse the same validation and calculation functions as manual controls. Agent calculation must not select or modify a player's active factory as a hidden side effect.

Every saved plan belongs to one force workspace and has a revision. Same-force players share plans; selection and preferences remain player-specific. Agent edits require the expected revision and are checked against the current player's connection, force, and existing action permissions. A stale proposal returns a conflict instead of overwriting manual work. Standalone manual planning needs no agent permission or account.

The wire schema carries prototype identity, selected recipes and machines, effects, constraints, and solver status. Return unmet targets, unused inputs, external imports, surplus, and line counts. Use stable plan and line IDs rather than UI positions. Keep truncated reads explicit and reject oversized mutations before changing a plan.

When AI is available, a player can attach the current plan to a request and review the resulting proposal in the planner. When it is unavailable, saved plans, recipe selection, solving, import/export, and blueprint inspection still work. Capability state should describe whether the agent is available without making the whole workspace appear offline.

## Performance and acceptance

Retain direct producer/consumer recipe indexes and visibility filtering. Do not introduce full-catalog scans when opening a recipe choice for one material. Build translation and prototype indexes at their existing lifecycle boundaries, and invalidate availability when research or mod state changes. Searching changes the picker; it does not solve the factory.

Reuse existing search rate limits and solve scheduling. Measure native event costs on the current large modpack before setting a frame budget. A solver result still in progress must stay pending; it cannot be exposed as a completed plan. If large calculations exceed the game tick budget, bound work per tick and retain only the latest requested revision.

Required behavioral checks:

1. With no service or credentials, create, edit, solve, export, import, save, and reload a manual plan. Disconnecting AI during work preserves the plan and draft.
2. Confirm output, input, and machine-led examples with independent material balances: ore-to-plate input limits; fixed assembler counts; multiple outputs; recycling loops; fuel; productivity; fluid temperatures; quality; surface restrictions.
3. Prove that exact constraints are satisfied, caps cannot be bypassed by another import path, shortages remain visible, and conflicting or unbounded goals are reported.
4. Manual and agent operations on identical data produce equivalent results. Reject stale edits and foreign or private plans without changing player selection or existing plans.
5. Exercise lifecycle and GUI routing in native Factorio: fresh install, adding Toby to an existing save, save/reload, mod configuration changes, player join, and multiplayer.
6. Measure selector opening, filtering, and solving on the installed large modpack. Record worst event cost and UPS effects alongside elapsed time. Verify the full UI in the game, including keyboard focus, drafts, native icons, and blueprint cursor preservation.

## Integration ownership

Coordinate runtime activation, packaging, agent tools, and the harness rewrite with the existing Toby development task. This task owns the planner subtree, lifecycle integration, packaging and native UI integration. The existing Toby task owns host agent tools, force-safe sharing, routing, benchmarks and deployment. Runtime activation, supply constraints, the embedded API, icon launcher and navigation between Planning and Agent are implemented. The agent workspace now uses a chat/task sidebar and Factory Planner frame/button styles. Force workspaces, shared books, shareable references, read/list/create APIs, retry-safe creation and revision-checked input edits are implemented. Exact and maximum counts on individual recipe lines, including nested floors, and revision-checked recipe configuration edits are implemented. Large-plan and selector performance acceptance remain open.

## Verified development behavior

On Factorio 2.1.21 in an isolated profile, without an external planner or AI service, the native API returned 300 iron plates/min from a 300 iron ore/min cap and exactly ten stone furnaces for a machine-count goal. A saved plan retained its input constraint and maximization goal after native save/reload. Adding the external Factory Planner 2.1.18 to that profile also loaded successfully without losing the embedded plan. Native rendering showed the planning window, actual prototype icons, input control and Agent navigation. These small-world checks do not establish worst-case performance on the large multiplayer modpack.

Native follow-up QA verified old per-player plan migration, rejection after switching force, preservation through force merge, shared plan reading, input edits, stale-revision rejection, and creation retries returning the same plan ID. The native harness rendered selectable chat rows, transcript, prototype references, icon launcher, and a draft containing a plan reference. Native retry tests returned the same saved plan and rejected changed inputs under the same request key. Taking a nested Toby book and updating it preserved user-edited root and project labels while appending current designs. Book export imported successfully into Factorio. These tests use a disposable profile and do not restart a live multiplayer server.

Plan references use `toby://plan/<forceIndex>/<planId>` within the current game. **Share** presents copyable text and **Ask Toby** adds it to the existing draft without sending. The host must recheck the actual requesting player’s current force and action permissions before every operation. Saved plan creation accepts an optional tool-call request key: retrying identical inputs returns the same result; changed inputs under the same key are rejected. `read_plan` returns full native recipe/machine/module/beacon settings and predicted balances without changing selection. Agent input, output, recipe and nesting edits require the latest revision. `edit_line` accepts recipe/machine choices, quality, modules, beacons, fuel, temperatures, activity and exact/maximum operating-machine counts. It stages and validates the configuration before replacing the existing line, preserving its ID. `set_products` replaces output goals; `nest_line` uses the same floor conversion as the native UI. Conflicting constraints remain saved with an explicit infeasible result.

The force-owned **Books** workspace is distinct from Factorio’s native **Game blueprints** shelf. `game.blueprints` and book-record contents are read-only collections with no record creation/import API. A player must initially drag a taken book into that shelf. Updating a held book appends a snapshot rather than replacing user-edited entries. Each force keeps up to32 saved designs grouped into conversation books; native book exports are bounded to2MB decoded data. Force merges preserve all entries even above the ordinary creation cap.

The reusable native QA fixture is `tests/fixtures/toby-planner-qa`. Enable it only in a disposable profile with a copied vanilla save containing a player; run a30-tick native benchmark. It intentionally researches all technologies, creates plans, changes forces and merges a test force. Never enable it on a live server or an original save.

The revised chat sidebar uses native Factory Planner list rows with full-width selection, task-state icons and hover details. The selected conversation shows its title, author and progress above the main pane. Drafts are kept per player, force and conversation, and survive joins, display changes and progress updates. Send and Stop target the displayed conversation while a requested selection is pending. Native rendering was inspected with running, completed, failed and long-title rows. Artifact batches acknowledge immutable design IDs, preserve multiple designs from the same chat, exclude inspection snapshots and report incomplete synchronization at the save capacity limit. Native QA exported and imported a two-design conversation book.

On the isolated current Beast modpack (32,213 recipes), five ore-capped single-recipe solves took 0.55–0.76ms per native Lua profiler. Its iron recipe consumes two ore per plate, and the independently checked result was120 plates/min from240 ore/min, with12.8 coal/min. This measures those API calls; it does not establish large-plan or selector UI performance. Machine unlock checks use the existing producer index rather than scanning the whole recipe catalog on every request.

The 0.0.8 native fixture verifies configured electric furnaces with speed modules and beacons against an independent throughput lower bound, rejection of excessive modules and stale/foreign edits without changing the plan, and exact/maximum machine counts inside a nested floor. A generated boiler recipe retains water and steam temperatures; its material balance uses Factorio 2.1 fluid heat capacities rather than assuming equal water and steam volumes. Recipe capacity limits constrain the native floor's existing relative recipe mix; nesting does not flatten every recipe into independent root variables.

On the isolated current Beast pack, five 0.0.8 small solves measured 0.69–0.85ms and five complete configuration edits measured 0.76–1.13ms. These measurements include native API processing and do not establish selector or large-plan frame budgets. The automated GUI mouse check is pending: the isolated macOS test window accepted keyboard shortcuts and rendered the planner, but synthetic mouse actions did not activate either mod controls or Factorio's vanilla Resume button, and the native click observer received no events. No live installation was changed for these checks.
