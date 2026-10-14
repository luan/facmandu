-- ** LOCAL UTIL **
---@param player LuaPlayer
local function toggle_paused_state(player, _, _)
    if not game.is_multiplayer() then
        local preferences = lib.globals.preferences(player)
        preferences.pause_on_interface = not preferences.pause_on_interface

        local main_elements = lib.globals.main_elements(player)
        main_dialog.set_pause_state(player, main_elements.main_frame)
    end
end

---@param player LuaPlayer
---@param direction NavigationDirection
local function navigate(player, direction)
    if lib.context.navigate(player, direction) then
        lib.gui.run_refresh(player, "all")
    end
end

---@param player LuaPlayer
local function refresh_title_bar(player)
    local ui_state = lib.globals.ui_state(player)
    if ui_state.main_elements.main_frame == nil then return end

    local factory = lib.context.get(player, "Factory")   ---@as Factory?
    local title_bar_elements = ui_state.main_elements.title_bar

    title_bar_elements.compact_button.enabled = factory ~= nil and factory.valid
    title_bar_elements.pause_button.enabled = (not game.is_multiplayer())

    title_bar_elements.back_button.enabled = lib.context.can_navigate(player, "back")
    title_bar_elements.forward_button.enabled = lib.context.can_navigate(player, "forward")
end


---@param player LuaPlayer
---@return number
local function determine_left_handle_width(player)
    local ui_state = lib.globals.ui_state(player)
    local half_total_width = ui_state.main_dialog_dimensions--[[@cast -nil]].width / 2

    local half_label_width = MAGIC_NUMBERS.titlebar_label_width / 2
    local left_margins = 3 * 8 + 2 * 4  -- horizontal spacing + drag handle margin
    local left_buttons_width = 3 * 24 + 2 * 8  -- button width + spacing

    return half_total_width - half_label_width - left_margins - left_buttons_width
end

---@param player LuaPlayer
local function build_title_bar(player)
    local main_elements = lib.globals.main_elements(player)
    main_elements.title_bar = {}

    local parent_flow = main_elements.flows.top_horizontal
    local flow_title_bar = parent_flow.add{type="flow", direction="horizontal", style="frame_header_flow",
        tags={mod="toby-planner", on_gui_click="re-center_main_dialog"}}
    flow_title_bar.drag_target = main_elements.main_frame

    local button_compact = flow_title_bar.add{type="sprite-button", style="toby_planner_button_frame",
        tags={mod="toby-planner", on_gui_click="switch_to_compact_view"}, tooltip={"toby-planner.switch_to_compact_view"},
        sprite="toby_planner_pin", mouse_button_filter={"left"}}
    main_elements.title_bar["compact_button"] = button_compact

    local preferences = lib.globals.preferences(player)
    local button_pause = flow_title_bar.add{type="sprite-button", sprite="toby_planner_play", tooltip={"toby-planner.pause_on_interface"},
        tags={mod="toby-planner", on_gui_click="toggle_pause_game"}, auto_toggle=true, style="toby_planner_button_frame",
        toggled=(not preferences.pause_on_interface), mouse_button_filter={"left"}}
    button_pause.style.padding = -1
    main_elements.title_bar["pause_button"] = button_pause

    local button_calculator = flow_title_bar.add{type="sprite-button", sprite="toby_planner_calculator",
        tooltip={"toby-planner.open_calculator"}, style="toby_planner_button_frame", mouse_button_filter={"left"},
        tags={mod="toby-planner", on_gui_click="open_calculator_dialog"}}
    button_calculator.style.padding = -3

    local left_handle = flow_title_bar.add{type="empty-widget", style="toby_flib_titlebar_drag_handle",
        ignored_by_interaction=true}
    left_handle.style.horizontally_stretchable = false  -- necessary so the other side stretches properly
    left_handle.style.width = determine_left_handle_width(player)
    flow_title_bar.add{type="label", caption="Production planner", style="toby_planner_label_frame_title",
        ignored_by_interaction=true}
    flow_title_bar.add{type="empty-widget", style="toby_flib_titlebar_drag_handle", ignored_by_interaction=true}

    flow_title_bar.add{type="button", caption={"toby-planner.preferences"}, style="toby_planner_button_frame_tool",
        tags={mod="toby-planner", on_gui_click="title_bar_open_preferences"}, mouse_button_filter={"left"}}

    local navigation_flow = flow_title_bar.add{type="flow", direction="horizontal"}
    navigation_flow.style.horizontal_spacing = 0

    local button_back = navigation_flow.add{type="sprite-button", sprite="utility/backward_arrow",
        tags={mod="toby-planner", on_gui_click="navigate_back"}, tooltip={"toby-planner.navigate_back"},
        style="toby_planner_button_frame", mouse_button_filter={"left"}}
    main_elements.title_bar["back_button"] = button_back
    local button_forward = navigation_flow.add{type="sprite-button", sprite="utility/forward_arrow",
        tags={mod="toby-planner", on_gui_click="navigate_forward"}, tooltip={"toby-planner.navigate_forward"},
        style="toby_planner_button_frame", mouse_button_filter={"left"}}
    main_elements.title_bar["forward_button"] = button_forward

    local button_close = flow_title_bar.add{type="sprite-button", tags={mod="toby-planner", on_gui_click="exit_main_dialog"},
        sprite="utility/close", tooltip={"toby-planner.close_interface"}, style="toby_planner_button_frame",
        mouse_button_filter={"left"}}
    button_close.style.padding = 1

    refresh_title_bar(player)
end


-- ** EVENTS **
local listeners = {}  ---@type ListenerDefinitions

listeners.gui = {
    on_gui_click = {
        {
            name = "re-center_main_dialog",
            handler = function(player, _, event)
                ---@cast event EventData.on_gui_click
                if event.button == defines.mouse_button_type.middle then
                    main_dialog.center(player)
                end
            end
        },
        {
            name = "switch_to_compact_view",
            handler = function(player, _, _)
                local floor = lib.context.get(player, "Floor")
                if floor and floor.level > 1 and floor:count() == 1 then
                    lib.context.ascend_floors(player, "up")
                end
                main_dialog.toggle_districts_view(player, true)

                main_dialog.toggle(player)
                lib.globals.ui_state(player).compact_view = true

                compact_dialog.toggle(player)
            end
        },
        {
            name = "toggle_pause_game",
            handler = toggle_paused_state
        },
        {
            name = "title_bar_open_preferences",
            handler = function(player, _, _)
                lib.gui.open_dialog(player, {dialog="preferences"})
            end
        },
        {
            name = "navigate_back",
            handler = function(player, _, _)
                navigate(player, "back")
            end
        },
        {
            name = "navigate_forward",
            handler = function(player, _, _)
                navigate(player, "forward")
            end
        },
        {
            name = "exit_main_dialog",
            handler = function(player, _, _)
                main_dialog.toggle(player)
            end
        },
    }
}  ---@as GUIListenerDefinition

listeners.player = {
    toby_planner_toggle_pause = function(player, _)
        if main_dialog.is_in_focus(player) then toggle_paused_state(player) end
    end,
    toby_planner_navigate_back = function(player, _)
        if main_dialog.is_in_focus(player) then navigate(player, "back") end
    end,
    toby_planner_navigate_forward = function(player, _)
        if main_dialog.is_in_focus(player) then navigate(player, "forward") end
    end,

    build_gui_element = function(player, event)
        ---@cast event BuildGUIElementEventData
        if event.trigger == "main_dialog" then
            build_title_bar(player)
        end
    end,
    refresh_gui_element = function(player, event)
        ---@cast event RefreshGUIElementEventData
        local triggers = {title_bar=true, all=true}
        if triggers[event.trigger] then refresh_title_bar(player) end
    end
}

return { listeners }
