---@class MachineDialogModalData: ModuleConfiguratorModalData
---@field machine_id ObjectID
---@field object Machine

local function read_capacity(modal_data)
    local text = modal_data.capacity_amount.text
    if not text:match("%S") then return nil, true end
    local count = tonumber(text)
    if not count or count ~= count or count < 0 or count > 1000000
        or modal_data.line.recipe.proto.energy <= MAGIC_NUMBERS.minimum_energy then return nil, false end
    return {count=count, mode=modal_data.capacity_mode.selected_index == 1 and "maximum" or "exact"}, true
end

local function validate_capacity(player)
    local modal_data = lib.globals.modal_data(player)
    local _, valid = read_capacity(modal_data)
    if modal_data.production_percent and modal_data.production_percent.enabled then
        local text = modal_data.production_percent.text
        local percent = tonumber(text)
        valid = valid and (not text:match("%S") or percent and percent == percent and percent >= 0 and percent <= 1000)
    end
    if modal_data.reactor_neighbors and modal_data.reactor_flow.visible then
        local neighbors = tonumber(modal_data.reactor_neighbors.text)
        valid = valid and neighbors and neighbors == neighbors and neighbors >= 0 and neighbors <= 4
    end
    modal_data.modal_elements.dialog_submit_button.enabled = valid
end

local function refresh_power_controls(player)
    local modal = lib.globals.modal_data(player)
    if not modal.solar_flow then return end
    local category = modal.object.proto.prototype_category
    modal.solar_flow.visible = category == "solar_panel"
    modal.reactor_flow.visible = category == "reactor"
    modal.storage_note.visible = category == "energy_storage"
    validate_capacity(player)
end

-- ** LOCAL UTIL **
---@param parent_flow LuaGuiElement
---@param modal_elements table
---@param identifier "machine" | "fuel"
local function add_defaults_buttons(parent_flow, modal_elements, identifier)
    parent_flow.add{type="empty-widget", style="toby_flib_horizontal_pusher"}

    ---@class SetMachineDefaultTags
    ---@field action "machine" | "fuel" | "machine_all" | "fuel_all"

    ---@type SetMachineDefaultTags
    local tags_machine = {mod="toby-planner", on_gui_click="set_machine_default", action=identifier}
    local button = parent_flow.add{type="sprite-button", tags=tags_machine, sprite="toby_planner_default",
        tooltip={"toby-planner.save_as_default_" .. identifier}, style="tool_button"}
    modal_elements[identifier] = button

    local action = (identifier .. "_all")  ---@as "machine_all" | "fuel_all"
    ---@type SetMachineDefaultTags
    local tags_all = {mod="toby-planner", on_gui_click="set_machine_default", action=action}
    local button_all = parent_flow.add{type="sprite-button", tags=tags_all, sprite="toby_planner_default_all",
        tooltip={"toby-planner.save_for_all_" .. identifier}, style="tool_button"}
    modal_elements[action] = button_all
end

---@param player LuaPlayer
local function refresh_defaults_buttons(player)
    local modal_data = lib.globals.modal_data(player)  ---@as MachineDialogModalData
    local modal_elements = modal_data.modal_elements
    local machine = modal_data.object  ---@as Machine

    -- Machine
    local machine_category = machine.proto.combined_category
    local machine_tooltip = defaults.generate_tooltip(player, "machines", machine_category)
    local equals_machine = defaults.equals_default(player, "machines", machine, machine_category)
    local equals_all_machines = defaults.equals_all_defaults(player, "machines", machine)

    modal_elements.machine.tooltip = {"", {"toby-planner.save_as_default_machine"}, "\n\n", machine_tooltip}
    modal_elements.machine.enabled = not equals_machine
    modal_elements.machine_all.enabled = not equals_all_machines

    -- Fuel
    local fuel_required = (machine.proto.energy_type == "burner")  ---@cast machine.proto.burner -nil
    local fuel_tooltip = {"toby-planner.machine_no_fuel_required"}  ---@type LocalisedString
    local equals_fuel, equals_all_fuels = false, false
    if fuel_required then  ---@cast machine.fuel -nil
        local category = machine.proto.burner.combined_category
        fuel_tooltip = defaults.generate_tooltip(player, "fuels", category)
        equals_fuel = defaults.equals_default(player, "fuels", machine.fuel, category)
        equals_all_fuels = defaults.equals_all_defaults(player, "fuels", machine.fuel)
    end

    modal_elements.fuel.tooltip = {"", {"toby-planner.save_as_default_fuel"}, "\n\n", fuel_tooltip}
    modal_elements.fuel.visible = fuel_required
    modal_elements.fuel_all.visible = fuel_required
    modal_elements.fuel.enabled = fuel_required and not equals_fuel
    modal_elements.fuel_all.enabled = fuel_required and not equals_all_fuels
end

---@param player LuaPlayer
---@param tags SetMachineDefaultTags
local function set_defaults(player, tags, _)
    local modal_data = lib.globals.modal_data(player)  ---@as MachineDialogModalData
    local machine = modal_data.object

    local machine_data = {
        prototype = machine.proto.name,
        quality = machine.quality_proto.name,
        modules = machine.module_set:compile_default()
    }

    if tags.action == "machine_all" then
        defaults.set_all(player, "machines", machine_data)
    elseif tags.action == "machine" then
        defaults.set(player, "machines", machine_data, machine.proto.combined_category)

    elseif tags.action == "fuel_all" then
        defaults.set_all(player, "fuels", {prototype=machine.fuel--[[@cast -nil]].proto.name})
    elseif tags.action == "fuel" then
        local category = machine.proto.burner--[[@cast -nil]].combined_category
        defaults.set(player, "fuels", {prototype=machine.fuel--[[@cast -nil]].proto.name}, category)
    end

    refresh_defaults_buttons(player)
end


---@param player LuaPlayer
local function refresh_fuel_frame(player)
    local modal_data = lib.globals.modal_data(player)  ---@as MachineDialogModalData
    local modal_elements = modal_data.modal_elements
    local machine = modal_data.object

    local burns_fuel = (machine.proto.energy_type == "burner")
    modal_elements.fuel_label.visible = (not burns_fuel)
    modal_elements.fuel_button_flow.clear()

    if not burns_fuel then return end  ---@cast machine.fuel -nil

    local elem_type = machine.fuel.proto.elem_type

    local button_fuel = modal_elements.fuel_button_flow.add{type="choose-elem-button", elem_type=elem_type,
        [elem_type]=machine.fuel.proto.name, elem_filters=machine:compile_fuel_filter(),
        tags={mod="toby-planner", on_gui_elem_changed="choose_fuel"}, style="toby_planner_sprite-button_inset"}
    button_fuel.style.size = 40
end


---@param player LuaPlayer
local function reset_machine(player)
    local modal_data = lib.globals.modal_data(player)  ---@as MachineDialogModalData
    local machine = modal_data.object
    machine:reset(player)

    -- Some manual refreshing which don't have their own method
    local modal_elements = lib.globals.modal_elements(player)
    modal_elements["machine_button"].elem_value = machine:elem_value()

    refresh_fuel_frame(player)
    module_configurator.refresh_modules_flow(player, false)
    refresh_defaults_buttons(player)
    refresh_power_controls(player)
end


---@param parent_frame LuaGuiElement
---@return LuaGuiElement flow_choices
local function create_choice_frame(parent_frame)
    local frame_choices = parent_frame.add{type="frame", direction="horizontal", style="toby_planner_frame_module"}
    frame_choices.style.width = (MAGIC_NUMBERS.module_dialog_element_width / 2) - 2
    local flow_choices = frame_choices.add{type="flow", direction="horizontal"}
    flow_choices.style.horizontally_stretchable = true
    flow_choices.style.horizontal_spacing = 4
    flow_choices.style.vertical_align = "center"
    flow_choices.style.height = 40

    return flow_choices
end

---@param parent_frame LuaGuiElement
---@param player LuaPlayer
---@param line Line
local function add_machine_frame(parent_frame, player, line)
    local modal_elements = lib.globals.modal_data(player)--[[@cast -nil]].modal_elements
    local flow_choices = create_choice_frame(parent_frame)

    local button_machine = flow_choices.add{type="choose-elem-button", elem_type="entity-with-quality",
        tags={mod="toby-planner", on_gui_elem_changed="choose_machine"}, style="toby_planner_sprite-button_inset",
        elem_filters=line:compile_machine_filter(player.force--[[@as LuaForce]])}
    button_machine.elem_value = line.machine:elem_value()
    button_machine.style.size = 40
    modal_elements["machine_button"] = button_machine
    add_defaults_buttons(flow_choices, modal_elements, "machine")
end

---@param parent_frame LuaGuiElement
---@param player LuaPlayer
local function add_fuel_frame(parent_frame, player)
    local modal_elements = lib.globals.modal_data(player)--[[@cast -nil]].modal_elements
    local flow_choices = create_choice_frame(parent_frame)

    local label_fuel = flow_choices.add{type="label", caption={"toby-planner.machine_no_fuel_required"}}
    label_fuel.style.padding = {6, 4}
    modal_elements["fuel_label"] = label_fuel

    local flow_fuel_button = flow_choices.add{type="flow", direction="horizontal"}
    modal_elements["fuel_button_flow"] = flow_fuel_button
    -- Button recreated on refresh because its type can change
    add_defaults_buttons(flow_choices, modal_elements, "fuel")

    refresh_fuel_frame(player)
end


---@param player LuaPlayer
---@param event EventData.on_gui_elem_changed
local function handle_machine_choice(player, _, event)
    local modal_data = lib.globals.modal_data(player)  ---@as MachineDialogModalData
    local machine = modal_data.object
    local elem_value = event.element.elem_value  ---@as PrototypeWithQuality

    if not elem_value then
        event.element.elem_value = machine:elem_value()  -- reset the machine so it can't be nil
        lib.cursor.create_flying_text(player, {"toby-planner.no_removal", {"toby-planner.pu_machine", 1}})
        return  -- nothing changed
    end

    local new_machine_proto = prototyper.util.find("machines", elem_value.name, machine.proto.combined_category)
    local new_quality_proto = prototyper.util.find("qualities", elem_value.quality, nil)

    -- Can't use Line:change_machine_to_proto() as that modifies the line, which we can't do
    machine.proto = new_machine_proto
    machine.quality_proto = new_quality_proto
    machine.parent.surface_compatibility = nil  -- reset since the machine changed
    machine:normalize_fuel(player)
    machine.module_set:normalize({compatibility=true, trim=true, effects=true})

    -- Make sure the line's beacon is removed if this machine no longer supports it
    if not machine.parent:uses_beacon_effects() then machine.parent:set_beacon(nil) end

    refresh_fuel_frame(player)
    module_configurator.refresh_modules_flow(player, false)
    refresh_defaults_buttons(player)
    refresh_power_controls(player)
end

---@param player LuaPlayer
---@param event EventData.on_gui_elem_changed
local function handle_fuel_choice(player, _, event)
    local modal_data = lib.globals.modal_data(player)  ---@as MachineDialogModalData
    local machine = modal_data.object  ---@cast machine.fuel -nil
    local elem_value = event.element.elem_value  ---@as string

    if not elem_value then
        event.element.elem_value = machine.fuel.proto.name  -- reset the fuel so it can't be nil
        lib.cursor.create_flying_text(player, {"toby-planner.no_removal", {"toby-planner.pu_fuel", 1}})
        return  -- nothing changed
    end

    local combined_category = machine.proto.burner--[[@cast -nil]].combined_category
    local proto = prototyper.util.find("fuels", elem_value, combined_category)  ---@as FPFuelPrototype
    machine.fuel:set_proto(proto, player)

    refresh_defaults_buttons(player)
end


---@param player LuaPlayer
---@param modal_data MachineDialogModalData
local function open_machine_dialog(player, modal_data)
    local original = OBJECT_INDEX[modal_data.machine_id]  ---@as Machine
    module_configurator.begin_edit(player, modal_data, original.parent)
    modal_data.object = modal_data.line.machine

    modal_data.module_set = modal_data.object.module_set

    local content_frame = modal_data.modal_elements.content_frame

    -- Machine & Fuel
    local flow_machine = content_frame.add{type="flow", direction="horizontal"}
    add_machine_frame(flow_machine, player, modal_data.line)
    add_fuel_frame(flow_machine, player)

    local capacity = content_frame.add{type="flow", direction="horizontal"}
    capacity.style.vertical_align = "center"
    capacity.add{type="label", caption="Operating machines", style="bold_label"}
    local constraint = modal_data.line.machine_constraint
    modal_data.capacity_amount = capacity.add{type="textfield", text=constraint and tostring(constraint.count) or "",
        numeric=true, allow_decimal=true, allow_negative=false, tooltip="Blank: calculate from product targets. Fractional operating capacity is allowed.",
        tags={mod="toby-planner", on_gui_text_changed="machine_capacity"}}
    modal_data.capacity_amount.style.width = 100
    modal_data.capacity_mode = capacity.add{type="drop-down", items={"At most", "Exactly"},
        selected_index=constraint and constraint.mode == "exact" and 2 or 1}
    capacity.add{type="label", caption="Current: " .. lib.format.number(modal_data.line.machine.amount, 3)}
    local share = content_frame.add{type="flow", direction="horizontal"}
    share.style.vertical_align = "center"
    share.add{type="label", caption="Remaining demand", style="bold_label"}
    modal_data.production_percent = share.add{type="textfield",
        text=modal_data.line.production_percent and tostring(modal_data.line.production_percent) or "",
        numeric=true, allow_decimal=true, allow_negative=false, enabled=modal_data.original_line:production_solver() == "sequential",
        tooltip="Sequential: cover this percentage of remaining demand (blank: 100%). Matrix solvers choose their own recipe ratios.",
        tags={mod="toby-planner", on_gui_text_changed="machine_production_percent"}}
    modal_data.production_percent.style.width = 100
    share.add{type="label", caption="% · Sequential solver"}
    modal_data.solar_flow = content_frame.add{type="flow", direction="horizontal"}
    modal_data.solar_flow.style.vertical_align = "center"
    modal_data.solar_flow.add{type="label", caption="Solar output", style="bold_label"}
    modal_data.power_mode = modal_data.solar_flow.add{type="drop-down", items={"Average day cycle", "Peak daylight"},
        selected_index=modal_data.line.power_mode == "peak" and 2 or 1}
    modal_data.reactor_flow = content_frame.add{type="flow", direction="horizontal"}
    modal_data.reactor_flow.style.vertical_align = "center"
    modal_data.reactor_flow.add{type="label", caption="Active neighbors per reactor", style="bold_label"}
    modal_data.reactor_neighbors = modal_data.reactor_flow.add{type="textfield", text=tostring(modal_data.line.neighbor_count or 0),
        numeric=true, allow_decimal=true, allow_negative=false,
        tags={mod="toby-planner", on_gui_text_changed="machine_reactor_neighbors"},
        tooltip="Mean active adjacent reactors, from 0 to 4. Neighbor bonuses increase heat without increasing fuel use."}
    modal_data.reactor_neighbors.style.width = 100
    modal_data.storage_note = content_frame.add{type="label",
        caption="Night load coverage uses the surface day cycle, stored energy and charge/discharge limits."}
    modal_data.storage_note.style.single_line = false
    modal_data.storage_note.style.maximal_width = 480
    refresh_power_controls(player)
    validate_capacity(player)

    -- Modules
    modal_data.defaults_refresher = "machine_defaults_refresher"
    module_configurator.add_modules_flow(content_frame, modal_data)
    module_configurator.refresh_modules_flow(player, false)
end

---@param player LuaPlayer
---@param action GUICloseAction
local function close_machine_dialog(player, action)
    local modal_data = lib.globals.modal_data(player)  ---@as MachineDialogModalData
    local machine, line = modal_data.object, modal_data.original_line

    if action == "submit" then
        local constraint, valid = read_capacity(modal_data)
        if not valid or not modal_data.line:set_machine_constraint(constraint) then return end
        if modal_data.production_percent.enabled then
            if not modal_data.line:set_production_percent(tonumber(modal_data.production_percent.text)) then return end
        end
        local mode = modal_data.solar_flow.visible and (modal_data.power_mode.selected_index == 2 and "peak" or "average") or nil
        local neighbors = modal_data.reactor_flow.visible and tonumber(modal_data.reactor_neighbors.text) or nil
        if not modal_data.line:set_power_configuration(mode, neighbors) then return end
        machine.module_set:normalize({sort=true})
        line.machine = machine
        machine.parent = line
        if modal_data.line.beacon then modal_data.line.beacon.parent = line end
        line:set_beacon(modal_data.line.beacon)
        line.machine_constraint = modal_data.line.machine_constraint
        line.production_percent = modal_data.line.production_percent
        line.power_mode, line.neighbor_count = mode, neighbors
        line.surface_compatibility = nil
        machine:summarize_effects()

        solver.update(player)
        lib.gui.run_refresh(player, "production")

    end
    module_configurator.finish_edit(modal_data)
end

-- ** EVENTS **
local listeners = {}  ---@type ListenerDefinitions

listeners.gui = {
    on_gui_text_changed = {{name="machine_capacity", handler=validate_capacity},
        {name="machine_production_percent", handler=validate_capacity},
        {name="machine_reactor_neighbors", handler=validate_capacity}},
    on_gui_elem_changed = {
        {
            name = "choose_machine",
            handler = handle_machine_choice
        },
        {
            name = "choose_fuel",
            handler = handle_fuel_choice
        }
    },
    on_gui_click = {
        {
            name = "set_machine_default",
            handler = set_defaults
        }
    },
    on_gui_checked_state_changed = {
        {
            name = "machine_checkbox_all",
            handler = refresh_defaults_buttons
        }
    }
}  ---@as GUIListenerDefinition

listeners.dialog = {
    dialog = "machine",
    metadata = function(modal_data)
        ---@cast modal_data MachineDialogModalData
        local machine = OBJECT_INDEX[modal_data.machine_id]  ---@as Machine
        local recipe_name = machine.parent.recipe.proto.localised_name
        return {
            caption = {"", {"toby-planner.edit"}, " ", {"toby-planner.pl_machine", 1}},
            subheader_text = {"toby-planner.machine_dialog_description", recipe_name},
            show_submit_button = true,
            reset_handler_name = "reset_machine"
        }  ---@as ModalDialogSettings
    end,
    open = open_machine_dialog,
    close = close_machine_dialog
}

listeners.global = {
    machine_defaults_refresher = refresh_defaults_buttons,
    reset_machine = reset_machine
}

return { listeners }
