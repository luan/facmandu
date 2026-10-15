-- Runs through Toby's existing native test hook, in an isolated empty world.
local events = require("__facmandu-assistant__/events").scope("planner-gui-qa")
local listeners = require("__facmandu-assistant__/planner/ui/base/compact_dialog")[2].player
events.on_nth_tick(1, function()
    if storage.planner_gui_qa_done then return end
    storage.planner_gui_qa_done = true
    local player = game.players[1]
    assert(player, "Native GUI QA requires a disposable copy with a player")
    local name = "toby_planner_frame_compact_dialog"
    local ok, result = pcall(function()
        local ui_state = lib.globals.ui_state(player)
        lib.gui.reset_player(player)
        local orphan = player.gui.screen.add{type="frame", name=name, visible=true}
        ui_state.compact_elements = {}
        listeners.on_player_display_resolution_changed(player, {})
        assert(not orphan.valid and player.gui.screen[name].visible)
        assert(player.gui.screen[name].tags.mod == "toby-planner")
        for index = 1, 6 do
            local previous = player.gui.screen[name]
            previous.visible = index % 2 == 0
            ui_state.compact_elements = {}
            listeners.on_player_display_scale_changed(player, {})
            assert(not previous.valid and player.gui.screen[name].visible == (index % 2 == 0))
            listeners.on_player_display_resolution_changed(player, {})
        end
        local current = player.gui.screen[name]
        local unrelated = player.gui.screen.add{type="frame", name="other_mod_qa"}
        lib.gui.reset_player(player)
        assert(not current.valid and unrelated.valid and not player.gui.screen[name])
        local legacy = player.gui.screen.add{type="frame", name=name}
        ui_state.compact_elements = {}
        lib.gui.reset_player(player)
        assert(not legacy.valid and unrelated.valid)
        listeners.on_player_display_resolution_changed(player, {})
        assert(not player.gui.screen[name].visible)
        return {passed=true, version=script.active_mods["facmandu-assistant"], displayChanges=14,
            recoveredOrphan=true, cleanedLegacy=true, preservedOtherGui=true}
    end)
    local proof = ok and result or {passed=false, error=tostring(result)}
    helpers.write_file("toby-planner-gui-qa.json", helpers.table_to_json(proof), false)
    log("TOBY_PLANNER_GUI_QA " .. helpers.table_to_json(proof))
end)
return function() end
