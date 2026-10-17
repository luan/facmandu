# Native layout UI check

Disposable copied saves only. This fixture researches technologies, creates a plan, changes its targets and creates a preview surface. Never load it on a live server or original save.

Package Toby using `tobyModArchive`, put this directory in the private profile's mods as `factoryplanner-test`, and enable both mods. Run at least 120 benchmark ticks on a copied save containing two retained players. The fixture is loaded through Toby's existing native planner test hook.

Read `script-output/toby-layout-ui-qa.json`. It must report `passed:true`. The check uses real GUI events and native blueprint import/build APIs, verifies ghost-only preview rendering, unchanged planner data, blueprint cursor delivery, book persistence, draft retention, stale-result rejection and cancellation.

`artifact.lua` is a native-importable ten-assembler layout fixture. This check tests UI delivery; production throughput and engine calculations have separate compiler/native qualification tests.
