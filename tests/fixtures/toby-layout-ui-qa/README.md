# Native layout UI check

Disposable copied saves only. This fixture researches technologies, creates a plan, changes its targets and creates a preview surface. Never load it on a live server or original save.

Package Toby using `tobyModArchive`, put this directory in the private profile's mods as `factoryplanner-test`, and enable both mods. Run at least 120 benchmark ticks on a copied save containing two retained players. The fixture is loaded through Toby's existing native planner test hook.

Read `script-output/toby-layout-ui-qa.json`. It must report `passed:true`. The check uses real GUI events and native blueprint import/build APIs, verifies ghost-only preview rendering, unchanged planner data, blueprint cursor delivery, book persistence, draft retention, stale-result rejection and cancellation.

`artifact.lua` is a native-importable ten-assembler layout fixture. This check tests UI delivery; production throughput and engine calculations have separate compiler/native qualification tests.

A native GUI/API pass does not establish that the camera rendered anything. Capture the gear/ghost scene in a normal graphical client at a 1280×900 window size (the native screenshot can be 2560×1800 on Retina). Run `check_preview.py` with Pillow 12 against the screenshots, then inspect the images. Require visible blueprint content with requester/storage controls expanded, after changing the sidebar controls, and after closing/reopening the workspace. The pixel check intentionally excludes prototype icons and the game world; an empty preview must fail.
