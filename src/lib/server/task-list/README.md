TaskList 0.6.0 (`scripts/task.lua`, `scripts/util.lua`) and flib 0.17.2
(`table.lua`), unchanged from their public mod archives. MIT licenses retained.

Factorio disallows native `require` in console commands. The connected service
bundles these modules in TaskList's console context instead. All task records,
normal methods, force ownership and GUI refreshes remain in TaskList. The installed
mod archives stay unchanged. Review the bridge before supporting another version.

Sources: https://codeberg.org/raiguard/TaskList and https://github.com/factoriolib/flib.
