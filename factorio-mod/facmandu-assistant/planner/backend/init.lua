local events = require('events').scope('planner')
local Realm = require("planner.backend.data.Realm")

local loader = require("planner.backend.handlers.loader")
local migrator = require("planner.backend.migrations.migrator")
require("planner.backend.handlers.prototyper")
require("planner.backend.handlers.defaults")
require("planner.backend.handlers.integrator")
require("planner.backend.handlers.interface")

local dev_export_string = "eNrtWUtv2zAM/i8+R0WdrTvk2MNOGzBsuw2BIct0KlQPV5KzBln++0jLbu08ihVt1yb1LSYpkh/5mabjdQK3lXUh07bwEJLZOsm5h2SWTM/Ss3SaTBJQsOQBCua4VL6vKbkI1q0qxY0B12lS1DgQK6HuZWR9U3Mlw6ov8hUXwPiiF2/TuZWAsX6tE6G4p6ifYzA8ZbimA5fcS0FOrFo2kTzc1GCC5Aqlmgcnb7PSAWQygEYXa/SdqxoqJ03IPOrNohUbGyhcggcrZ4taBLnEXLPcGhktWvEwp59fvkVxPBcs1a9Nr/NjDfNCgkGgiPYaLQVWc0FQZgllhpKCB56FVQWtyBMsqSslSwlFMguuBsyhgFIaKLKcjnJtaxOaWt/U0qG4lczSzXySBFtlpbLWUUp3NWwEkwQ7CgoN8Rc6HGL6gpLYQUn53Cu+R8ljkPZxRYcHkN276MyjhMJhPSpwPNQOmm5RISzmOCu58jBJODULoiv0BE4gCRpOpefnRARxRZB6SL62ol0oqAedY1EWrD3HPgw7JhwvA+q30LXWB+C11M+2wxnrdMPWvqtoLA/5Ki0CzJTUMnSY8d6tFWTt/XuHspH+AOJItBg2Ouof6CfdASye3K5C32S7Em2oFy9ER/ePmzlxIgcurOkX4DJKdgHmnaIfLQr/Y97TZ2+crwDH9P6ONbrXbtU0tkpYrYGuExz3T5k8+GgSOMYFK2tneDMtxpHz1kYOlu85e75nOp122/9EllvNFwaCFP4UebC1mUyfZzOhjXWcCac/E6Sj3RPvjVNZOtOx24e77QOAYvjWGY5y8vuAnnsbS39J06DeWp/LmgZyb1LT9R5UVsmClVHZp+4VaCl28iDDvTlsXn2OjMQaibWHWPOnUYsXS24Evp4J6UQtw7izvsMnV1sVg2+sIw3eLw2ErbADTPD8ZN5d05EAj9kzdGXxae1Y9wfW7t+oR7JxANcMzCKqewQ4DOwodg7CNQRUqhrXkCvggZVSBbx9O6N/2j4GfcFSf7rYvAkC5lYq9psTnvSCIQMiLIYJvhAhkyYaluDiRalJwMANexhl7E51bLQUlh/121VHusi3II/z6WfL0l9ZB6yqdTVsx7bqNB519M3moe/wipvrV/gOT1eP+8pN0Oabv0gxb7I="

---@class UIStateTable
---@field main_dialog_dimensions DisplayResolution?
---@field last_action LastAction?
---@field views_data ItemViewsData?
---@field main_elements table
---@field compact_elements table
---@field calculator_elements table<string, LuaGuiElement>
---@field last_selected_picker_group integer?
---@field held_object_id ObjectID?
---@field tooltips table
---@field modal_dialog_type ModalDialogType?
---@field modal_data ModalData?
---@field context_menu LuaGuiElement?
---@field compact_view boolean
---@field districts_view boolean

---@class LastAction
---@field action_name string | defines.events
---@field tick MapTick

---@param player_table PlayerTable
local function reset_ui_state(player_table)
    -- The UI table gets replaced because the whole interface is reset
    player_table.ui_state = {
        main_dialog_dimensions = nil,
        last_action = nil,
        views_data = nil,
        main_elements = {},
        compact_elements = {},
        calculator_elements = {},
        last_selected_picker_group = nil,
        held_object_id = nil,
        tooltips = {},

        modal_dialog_type = nil,
        modal_data = nil,
        context_menu = nil,

        compact_view = false,
        districts_view = false
    }
end


---@class PlayerTable
---@field preferences PreferencesTable
---@field ui_state UIStateTable
---@field realm Realm
---@field context ContextTable
---@field translation_tables TranslationTables?
---@field clipboard ClipboardEntry?

---@alias TranslationTables table<string, flib.TranslatedDictionary>

---@param player LuaPlayer
local function force_realm(player)
    local realms = storage.planner.realms
    local index = player.force.index
    if not realms[index] then realms[index] = Realm.init() end
    return realms[index]
end

-- Preserve every legacy player realm when introducing force ownership.
local function migrate_realms()
    storage.planner.realms = storage.planner.realms or {}
    for index, state in pairs(storage.planner.players) do
        local player = game.get_player(index)
        if player then
            local realm = storage.planner.realms[player.force.index]
            if not realm then
                realm = state.realm or Realm.init()
                storage.planner.realms[player.force.index] = realm
            elseif state.realm and state.realm ~= realm then realm:merge(state.realm) end
            state.realm = realm
        end
    end
end

---@param player LuaPlayer
local function player_init(player)
    storage.planner.players[player.index] = {}  ---@diagnostic disable-line: missing-fields
    local player_table = storage.planner.players[player.index]

    player_table.realm = force_realm(player)
    lib.context.init(player_table)
    lib.context.set(player, player_table.realm.first)

    lib.preferences.reload(player_table)
    reset_ui_state(player_table)

    -- Set default fuel to coal because anything else is awkward
    defaults.set_all(player, "fuels", {prototype="coal"})

    lib.gui.toggle_mod_gui(player)
    lib.nth_tick.register((game.tick + 1), "shrinkwrap_interface", {player_index=player.index})

    if DEVELOPER_MODE then
        lib.porter.add_factories(player, dev_export_string)

        player.force--[[@as LuaForce]].research_all_technologies()
        player.clear_recipe_notifications()
        player.cheat_mode = true
    end
end

---@param player LuaPlayer
local function refresh_player_table(player)
    local player_table = storage.planner.players[player.index]

    lib.preferences.reload(player_table)
    reset_ui_state(player_table)

    defaults.migrate(player_table)
    lib.temperature.migrate(player_table)

    lib.context.validate(player)

    player_table.translation_tables = nil
    player_table.clipboard = nil

    player_table.realm:validate(player)

    -- Apply substitutions that were just pulled in, as they won't get an invalidation event
    player_table.realm:refresh_lines(player)
end


local function generate_object_index()
    OBJECT_INDEX = {}  ---@type table<ObjectID, Object>
    for _, realm in pairs(storage.planner.realms or {}) do realm:index() end
    -- Old saves need their index before configuration migration runs.
    for _, state in pairs(storage.planner.players) do if state.realm then state.realm:index() end end
end

---@param fake_load boolean?
local function run_on_load(fake_load)
    if not fake_load then
        -- Pre-planner Toby saves reach on_load before configuration migration.
        -- Only that later callback may initialize persistent storage.
        if not storage.planner or "2.1.18" ~= storage.planner.version then
            return  -- if the mod version changed, this needs to just run during migration
        end

        generate_object_index()
    end

    lib.nth_tick.register_all()

    loader.run()
end


---@class GlobalTable
---@field players table<PlayerIndex, PlayerTable>
---@field prototypes PrototypeLists
---@field integrations IntegrationsTable
---@field next_object_ID integer
---@field nth_tick_events table<MapTick, NthTickEvent>
---@field installed_mods ModToVersion

local function global_init()
    -- Set up a new save for development if necessary
    local freeplay = remote.interfaces["freeplay"]
    if DEVELOPER_MODE and freeplay then  -- Disable freeplay popup-message
        if freeplay["set_skip_intro"] then remote.call("freeplay", "set_skip_intro", true) end
        if freeplay["set_disable_crashsite"] then remote.call("freeplay", "set_disable_crashsite", true) end
    end

    storage.planner.players = {}  -- Table containing all player-specific data
    storage.planner.realms = {}  -- Force workspaces survive players leaving/removal.
    storage.planner.next_object_ID = 1  -- Counter used for assigning incrementing IDs to all objects
    storage.planner.nth_tick_events = {}  -- Save metadata about currently registered on_nth_tick events

    -- Table containing all relevant prototypes indexed by ID
    storage.planner.prototypes = {}  ---@diagnostic disable-line: missing-fields
    -- Table containing all integration data collected from other mods
    storage.planner.integrations = {}  ---@diagnostic disable-line: missing-fields
    prototyper.build()  -- Generate all relevant prototypes and save them in storage.planner
    integrator.initialize()  -- Collect the integration data that generation doesn't cover
    run_on_load(true)  -- Run loader which creates useful indexes of prototype data
    generate_object_index()  -- This just initializes the OBJECT_INDEX variable

    -- Retain current modset to detect mod changes for invalid factories
    storage.planner.version = "2.1.18"
    storage.planner.installed_mods = script.active_mods  ---@as ModToVersion

    lib.translator.on_init()  -- Initialize flib's translation module
    prototyper.util.build_translation_dictionaries()

    for _, player in pairs(game.players) do player_init(player) end

    if test_runner then test_runner() end  -- Run if a test mod is active
end

-- Prompts migrations, a GUI and prototype reload, and a validity check on all factories
local function handle_configuration_change()
    if not storage.planner.installed_mods then global_init(); return end
    local migrations = migrator.determine_migrations()

    if not migrations then  -- implies this save can't be migrated anymore
        error("Unsupported planner storage version; retain the save and migrate it with its original planner")
    end

    storage.planner.prototypes = {}  ---@diagnostic disable-line: missing-fields
    storage.planner.integrations = {}  ---@diagnostic disable-line: missing-fields
    prototyper.build()
    integrator.initialize()
    run_on_load(true)

    migrator.migrate_global(migrations)
    migrator.migrate_player_tables(migrations)
    migrate_realms()
    generate_object_index()  -- rebuild this after objects have been migrated

    for index, player in pairs(game.players) do
        refresh_player_table(player)  -- part of migration cleanup

        lib.gui.reset_player(player)  -- Destroys all existing GUI's
        lib.gui.toggle_mod_gui(player)  -- Recreates the mod-GUI if necessary

        -- Update calculations in case prototypes changed in a relevant way
        for district in storage.planner.players[index].realm:iterator() do
            district.needs_refresh = true
            for factory in district:iterator() do
                factory:clear_solver_cache()
                solver.update(player, factory)
            end
        end
    end

    storage.planner.version = "2.1.18"
    storage.planner.installed_mods = script.active_mods  ---@as ModToVersion

    lib.translator.on_configuration_changed()
    prototyper.util.build_translation_dictionaries()
end


events.on_load(run_on_load)

events.on_init(global_init)

events.on_configuration_changed(handle_configuration_change)


-- ** COMMANDS **
commands.add_command("toby-planner-restart-translation", {"command-help.toby_planner_restart_translation"}, function()
    lib.translator.on_init()
    prototyper.util.build_translation_dictionaries()
end)
commands.add_command("toby-planner-shrinkwrap-interface", {"command-help.toby_planner_shrinkwrap_interface"}, function(command)
    if command.player_index then
        lib.nth_tick.register((game.tick + 1), "shrinkwrap_interface", {player_index=command.player_index})
    end
end)


-- ** EVENTS **
local listeners = {}

local function change_force(player)
    local state = lib.globals.player_table(player)
    if not state then return end
    -- Destroy old dialogs before rebinding; they must not edit the previous force.
    lib.gui.reset_player(player)
    reset_ui_state(state)
    state.clipboard = nil
    state.realm = force_realm(player)
    lib.context.init(state)
    lib.context.set(player, state.realm.first)
    lib.gui.toggle_mod_gui(player)
end

listeners.player = {
    on_player_dictionaries_ready = (function(player, _)
        local player_table = lib.globals.player_table(player)
        player_table.translation_tables = lib.translator.get_all(player.index)

        modal_dialog.set_searchfield_state(player)  -- enables searchfields if possible
    end),

    on_player_joined_game = (function(_, event)
        lib.translator.on_player_joined_game(event)
    end),
    on_player_locale_changed = (function(_, event)
        lib.translator.on_player_locale_changed(event)
    end),
    on_string_translated = (function(_, event)
        lib.translator.on_string_translated(event)
    end)
}

listeners.game = {
    on_player_created = (function(event)
        local player = game.get_player(event.player_index)
        player_init(player--[[@cast -nil]])
    end),
    on_player_removed = (function(event)
        storage.planner.players[event.player_index] = nil
    end),

    on_force_created = (function(event)
        integrator.collect_force(event.force.index)
    end),
    on_forces_merged = (function(event)
        integrator.forget_force(event.source_index)
        local realms = storage.planner.realms
        local destination = realms[event.destination.index]
        local source = realms[event.source_index]
        if source then
            if destination then destination:merge(source)
            else realms[event.destination.index] = source end
            realms[event.source_index] = nil
        end
        for _, player in pairs(event.destination.players) do
            change_force(player)
        end
        local player = event.destination.players[1]
        if player then force_realm(player):refresh_lines(player, game.tick + 1) end
    end),
    on_player_changed_force = (function(event)
        local player = game.get_player(event.player_index)  ---@cast player -nil
        change_force(player)
    end),

    on_tick = lib.translator.on_tick
}

return { listeners }
