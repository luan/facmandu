local FactoryItem = require("planner.backend.data.FactoryItem")

---@alias ItemCategory "product" | "byproduct" | "ingredient"

---@class PickerDialogModalData: ModalData
---@field item_id ObjectID?
---@field item_category ItemCategory
---@field create_factory boolean?
---@field item FactoryItem?
---@field timescale Timescale
---@field belts_or_lanes BeltsOrLanes
---@field amount_defined_by ItemDefinitionType
---@field item_proto FPItemPrototype?
---@field belt_proto FPBeltPrototype?
---@field belt_stack integer
---@field selected_group_id integer?

-- ** ITEM PICKER **
---@class PickerItemData
---@field proto FPItemPrototype
---@field translated_name string
---@field unlocked boolean
---@field existing boolean
---@field visible boolean
---@field button LuaGuiElement?

---@class PickerGroupData
---@field button LuaGuiElement
---@field items PickerItemData[]
---@field subgroup_elements table<string, LuaGuiElement>
---@field subgroup_counts table<string, integer>
---@field visible_rows integer
---@field scroll_pane LuaGuiElement?
---@field flow LuaGuiElement?

---@param modal_data PickerDialogModalData
---@param group PickerGroupData
local function render_item_group(modal_data, group)
    if not group.scroll_pane then
        local scroll = modal_data.modal_elements.filter_frame.add{type="scroll-pane", style="shallow_scroll_pane"}
        scroll.style.vertically_stretchable = true
        local frame = scroll.add{type="frame", style="slot_button_deep_frame"}
        frame.style.vertically_stretchable = true
        group.scroll_pane = scroll
        group.flow = frame.add{type="flow", direction="vertical"}
        group.flow.style.vertical_spacing = 0
        for _, data in ipairs(group.items) do
            local proto = data.proto
            local subgroup = proto.subgroup.name
            local row = group.subgroup_elements[subgroup]
            if not row then
                row = group.flow.add{type="table", column_count=MAGIC_NUMBERS.items_per_row, style="filter_slot_table"}
                row.style.horizontally_stretchable = true
                group.subgroup_elements[subgroup] = row
            end
            local style, status_tooltip = "toby_flib_slot_button_default", nil
            if data.existing then
                style = "toby_flib_slot_button_blue"
                status_tooltip = {"toby-planner.picker_already_selected_tt", {"toby-planner.pu_" .. modal_data.item_category, 1}}
            elseif not data.unlocked then
                style = "toby_flib_slot_button_red"
                status_tooltip = {"toby-planner.picker_unresearched_tt"}
            end
            local name = proto.temperature and proto.base_name or proto.name
            ---@class SelectPickerItemTags
            ---@field item_id integer
            ---@field category_id integer
            ---@field enabled boolean
            local tags = {mod="toby-planner", on_gui_click="select_picker_item", item_id=proto.id,
                category_id=proto.category_id, enabled=not data.existing}
            data.button = row.add{type="sprite-button", tags=tags, sprite=proto.sprite, style=style,
                elem_tooltip=(proto.type ~= "entity") and {type=proto.type, name=name} or nil,
                mouse_button_filter={"left"}}
            data.button.tooltip = status_tooltip and {"", proto.tooltip or "", proto.tooltip and "\n\n" or "", status_tooltip} or proto.tooltip
        end
    end
    for _, data in ipairs(group.items) do data.button.visible = data.visible end
    for name, element in pairs(group.subgroup_elements) do element.visible = group.subgroup_counts[name] > 0 end
end

---@param modal_data PickerDialogModalData
---@param new_group_id integer
local function select_item_group(modal_data, new_group_id)
    modal_data.selected_group_id = new_group_id
    local group = modal_data.modal_elements.groups[new_group_id]
    render_item_group(modal_data, group)
    for group_id, other in ipairs(modal_data.modal_elements.groups) do
        local selected = group_id == new_group_id
        other.button.toggled = selected
        if other.scroll_pane then other.scroll_pane.visible = selected end
    end
    modal_data.modal_elements.filter_frame.style.natural_height = group.visible_rows * 40 + 24
end

---@param player LuaPlayer
---@param search_term string
local function apply_item_filter(player, search_term)
    local modal_data = lib.globals.modal_data(player)  ---@as PickerDialogModalData
    local elements = modal_data.modal_elements
    local show_unresearched = lib.globals.preferences(player).show_unresearched_items
    local first_visible_group_id
    for group_id, group in ipairs(elements.groups) do
        local counts, visible_rows = {}, 0
        for _, data in ipairs(group.items) do
            local matches = search_term == data.proto.name or string.find(data.translated_name, search_term, 1, true) ~= nil
            data.visible = matches and (show_unresearched or data.unlocked)
            local subgroup = data.proto.subgroup.name
            counts[subgroup] = (counts[subgroup] or 0) + (data.visible and 1 or 0)
        end
        for _, count in pairs(counts) do visible_rows = visible_rows + math.ceil(count / MAGIC_NUMBERS.items_per_row) end
        group.subgroup_counts, group.visible_rows = counts, visible_rows
        group.button.visible = visible_rows > 0
        if visible_rows > 0 then first_visible_group_id = first_visible_group_id or group_id end
    end
    elements.warning_label.visible = first_visible_group_id == nil
    elements.filter_frame.visible = first_visible_group_id ~= nil
    if first_visible_group_id then
        local selected = modal_data.selected_group_id
        select_item_group(modal_data, elements.groups[selected].button.visible and selected or first_visible_group_id)
    end
end

---@param parent_flow LuaGuiElement
---@param player LuaPlayer
local function add_item_picker(parent_flow, player)
    local player_table = lib.globals.player_table(player)
    local modal_data = player_table.ui_state.modal_data  ---@as PickerDialogModalData
    local elements = modal_data.modal_elements
    local translations = player_table.translation_tables
    local unlock_cache = {}  ---@type PrototypeUnlockCache
    local force = player.force  ---@as LuaForce
    local warning = parent_flow.add{type="label", caption={"toby-planner.error_message", {"toby-planner.no_item_found"}}}
    warning.style.font = "heading-2"
    warning.style.margin = 12
    warning.visible = false
    elements.warning_label = warning
    local groups_per_row = MAGIC_NUMBERS.groups_per_row
    local tabs_width = 71 * groups_per_row
    local scroll = parent_flow.add{type="scroll-pane", style="toby_planner_scroll-pane_group_tabs", horizontal_scroll_policy="never"}
    scroll.style.width = tabs_width
    scroll.style.maximal_height = MAGIC_NUMBERS.group_max_rows * 76
    local tabs = scroll.add{type="table", column_count=groups_per_row}
    tabs.style.width = tabs_width
    tabs.style.horizontal_spacing = 0
    tabs.style.vertical_spacing = 0
    elements.filter_frame = parent_flow.add{type="frame", style="filter_frame"}
    local group_ids, existing = {}, {}
    elements.groups = {}
    if not modal_data.create_factory then
        local factory = lib.context.get(player, "Factory")  ---@as Factory
        for product in factory:iterator() do existing[product.proto.name] = true end
    end
    -- Index the catalog for search; construct native item buttons only for visited groups.
    for _, proto in ipairs(SORTED_ITEMS) do
        if not proto.hidden and not proto.ingredient_only then
            local name = proto.group.name
            local id = group_ids[name]
            if not id then
                id = #elements.groups + 1
                group_ids[name] = id
                ---@class SelectPickerItemGroupTags
                ---@field group_id integer
                local tags = {mod="toby-planner", on_gui_click="select_picker_item_group", group_id=id}
                elements.groups[id] = {button=tabs.add{type="sprite-button", tags=tags, sprite="item-group/" .. name,
                    style="toby_planner_sprite-button_group_tab", tooltip=proto.group.localised_name, mouse_button_filter={"left"}},
                    items={}, subgroup_elements={}}
            end
            local translated = translations and translations[proto.type][proto.name]
            local items = elements.groups[id].items
            items[#items + 1] = {proto=proto, translated_name=translated and helpers.multilingual_to_lower(translated) or proto.name,
                unlocked=lib.availability.is_item_unlocked(force, proto, unlock_cache), existing=existing[proto.name] or false}
        end
    end
    if math.ceil(#elements.groups / groups_per_row) > MAGIC_NUMBERS.group_max_rows then
        local width = MAGIC_NUMBERS.items_per_row * 40 + 12
        scroll.style = "toby_planner_scroll-pane_group_tabs_scrolling"
        scroll.style.width = width
        scroll.style.maximal_height = MAGIC_NUMBERS.group_max_rows * 76
        tabs.style.width = width
    end
    local previous = player_table.ui_state.last_selected_picker_group
    modal_data.selected_group_id = previous and elements.groups[previous] and previous or 1
end


-- ** PICKER DIALOG **
---@param modal_data PickerDialogModalData
local function set_appropriate_focus(modal_data)
    if modal_data.amount_defined_by == "machines" then
        lib.gui.select_all(modal_data.modal_elements["machine_count_textfield"])
    elseif modal_data.amount_defined_by == "amount" then
        lib.gui.select_all(modal_data.modal_elements["item_amount_textfield"])
    else  -- "belts"
        lib.gui.select_all(modal_data.modal_elements["belt_amount_textfield"])
    end
end

---@param modal_data PickerDialogModalData
local function refresh_definition_controls(modal_data)
    local modal_elements = modal_data.modal_elements
    local machines = (modal_data.amount_defined_by == "machines")
    local belts = (modal_data.belt_proto ~= nil)

    modal_elements.item_amount_textfield.enabled = not machines and not belts
    modal_elements.belt_choice_button.enabled = not machines
        and modal_data.item_proto ~= nil and modal_data.item_proto.type == "item"
    modal_elements.belt_amount_textfield.enabled = not machines and belts
    modal_elements.belt_stack_dropdown.enabled = not machines and belts
    modal_elements.machine_count_textfield.enabled = machines
end

-- Synchronizes the amount fields when a belt is selected
---@param modal_data PickerDialogModalData
local function sync_amounts(modal_data)
    local modal_elements = modal_data.modal_elements

    local belt_amount = lib.gui.parse_expression_field(modal_elements.belt_amount_textfield, true)
    if belt_amount == nil then
        modal_elements.item_amount_textfield.text = ""
    else
        local belt_proto = modal_data.belt_proto  ---@cast belt_proto -nil
        local throughput = belt_proto.throughput * ((modal_data.belts_or_lanes == "belts") and 1 or 0.5)
        local item_amount = belt_amount * throughput * modal_data.timescale * modal_data.belt_stack
        modal_elements.item_amount_textfield.text = lib.format.number(item_amount, 6)
    end
end

---@param modal_data PickerDialogModalData
---@param belt_proto FPBeltPrototype?
local function set_belt_proto(modal_data, belt_proto)
    modal_data.belt_proto = belt_proto

    local modal_elements = modal_data.modal_elements
    if modal_data.amount_defined_by ~= "machines" then
        modal_data.amount_defined_by = (belt_proto ~= nil) and "belts" or "amount"
    end

    if belt_proto == nil then
        modal_elements.belt_choice_button.elem_value = nil
        modal_elements.belt_amount_textfield.text = ""
    else
        -- Might double set the choice button, but it doesn't matter
        modal_elements.belt_choice_button.elem_value = belt_proto.name

        local item_amount = lib.gui.parse_expression_field(modal_elements.item_amount_textfield, true)
        if item_amount ~= nil then
            local throughput = belt_proto.throughput * ((modal_data.belts_or_lanes == "belts") and 1 or 0.5)
            local belt_amount = item_amount / throughput / modal_data.timescale / modal_data.belt_stack
            modal_elements.belt_amount_textfield.text = lib.format.number(belt_amount, 6)
        end
        sync_amounts(modal_data)
    end
end

---@param modal_data PickerDialogModalData
---@param item_proto FPItemPrototype?
local function set_item_proto(modal_data, item_proto)
    local modal_elements = modal_data.modal_elements
    modal_data.item_proto = item_proto

    local item_choice_button = modal_elements.item_choice_button
    item_choice_button.sprite = (item_proto) and item_proto.sprite or nil
    if item_proto then
        local name = (item_proto.temperature) and item_proto.base_name or item_proto.name
        item_choice_button.elem_tooltip = (item_proto.type ~= "entity") and {type=item_proto.type, name=name} or nil
        item_choice_button.tooltip = item_proto.tooltip
    end

    -- Disable definition by belt for non-items
    local is_item = (item_proto and item_proto.type == "item") or false
    if not is_item then set_belt_proto(modal_data, nil) end
end

---@param modal_elements table
local function update_dialog_submit_button(modal_elements)
    local item_choice_button = modal_elements.item_choice_button
    local item_amount = lib.gui.parse_expression_field(modal_elements.item_amount_textfield, true)

    local message  ---@type LocalisedString
    if item_choice_button.sprite == "" then
        message = {"toby-planner.picker_issue_select_item"}
    elseif modal_elements.machine_count_checkbox.state then
        local machine_count = lib.gui.parse_expression_field(modal_elements.machine_count_textfield, true)
        if machine_count == nil then message = {"toby-planner.picker_issue_enter_machine_count"} end
    elseif item_amount == nil then
        -- The item amount will be filled even if the item is defined_by ~= "amount"
        message = {"toby-planner.picker_issue_enter_amount"}
    end

    modal_dialog.set_submit_button_state(modal_elements, (message == nil), message)
end


---@param parent_flow LuaGuiElement
---@param modal_data PickerDialogModalData
---@param item FactoryItem?
local function add_item_pane(parent_flow, modal_data, item)
    local function create_flow()
        local flow = parent_flow.add{type="flow", direction="horizontal"}
        flow.style.vertical_align = "center"
        flow.style.horizontal_spacing = 8
        flow.style.bottom_margin = 6
        return flow
    end

    local modal_elements = modal_data.modal_elements
    local defined_by = (item) and item.definition.type or "amount"
    modal_data.amount_defined_by = defined_by

    local flow_amount = create_flow()
    local item_choice_button = flow_amount.add{type="sprite-button", style="toby_planner_sprite-button_inset",
        tags={mod="toby-planner", on_gui_click="picker_item_choice"}}
    item_choice_button.style.size = 40
    item_choice_button.style.right_margin = 12
    modal_elements["item_choice_button"] = item_choice_button

    local timescale_string = {"toby-planner." .. lib.gui.timescale_as_string(modal_data.timescale)}
    flow_amount.add{type="label", caption={"toby-planner.amount_per", timescale_string}}

    local item_amount = ""
    if item and item.definition.type == "amount" then
        local definition = item.definition  ---@as AmountItemDefinition
        if item.proto.special then
            if lib.is_special_power_item(item.proto.name) then
                item_amount = tostring(definition.amount / 1e6) .. "M"
            else  -- any of the emission types
                item_amount = tostring(definition.amount)
            end
        else
            item_amount = tostring(definition.amount * modal_data.timescale)
        end
    end

    local textfield_amount = flow_amount.add{type="textfield", text=item_amount,
        tags={mod="toby-planner", on_gui_text_changed="picker_amount_changed", on_gui_confirmed="picker_amount",
        width=80}, tooltip={"toby-planner.expression_textfield"}}
    textfield_amount.style.width = 80
    modal_elements["item_amount_textfield"] = textfield_amount


    local flow_belts = create_flow()
    local belts_or_lanes = {"toby-planner.pl_" .. modal_data.belts_or_lanes:sub(1, -2), 1}
    flow_belts.add{type="label", caption={"toby-planner.amount_by", belts_or_lanes}}

    local choose_belt_button = flow_belts.add{type="choose-elem-button", elem_type="entity",
        tags={mod="toby-planner", on_gui_elem_changed="picker_choose_belt"}, elem_filters=lib.gui.compile_elem_filter("belts"),
        style="toby_planner_sprite-button_inset"}
    modal_elements["belt_choice_button"] = choose_belt_button

    flow_belts.add{type="label", caption="x"}

    -- Products are stored in belts, so they need to be converted for display as lanes
    local lane_multiplier = (modal_data.belts_or_lanes == "lanes") and 2 or 1
    local belt_amount = (item and item.definition.type == "belts")
        and tostring(item.definition.belt_count * lane_multiplier) or ""
    local belt_width = 50
    local textfield_belts = flow_belts.add{type="textfield", text=belt_amount,
        tags={mod="toby-planner", on_gui_text_changed="picker_belt_amount", on_gui_confirmed="picker_amount",
        width=belt_width}, tooltip={"toby-planner.expression_textfield"}}
    textfield_belts.style.width = belt_width
    modal_elements["belt_amount_textfield"] = textfield_belts

    flow_belts.add{type="label", caption="x"}

    local belt_stack_dropdown = flow_belts.add{type="drop-down", items=lib.preferences.belt_stack_options,
        tags={mod="toby-planner", on_gui_selection_state_changed="picker_choose_belt_stack"},
        selected_index=modal_data.belt_stack}
    belt_stack_dropdown.style.minimal_width = 0
    modal_elements["belt_stack_dropdown"] = belt_stack_dropdown
    flow_belts.add{type="label", caption={"toby-planner.pl_stack", 2}}

    parent_flow.add{type="line", direction="horizontal"}.style.bottom_margin = 6

    local flow_machines = create_flow()
    flow_machines.style.horizontal_spacing = 12
    modal_elements["machine_count_checkbox"] = flow_machines.add{type="checkbox", state=(defined_by == "machines"),
        tags={mod="toby-planner", on_gui_checked_state_changed="picker_toggle_machines"},
        caption={"toby-planner.info_label", {"toby-planner.picker_machine_count"}},
        tooltip={"toby-planner.picker_machine_count_tt", {"toby-planner.pl_" .. modal_data.item_category, 1},
            {"toby-planner.pl_" .. modal_data.item_category, 2}}}

    local machine_width = 50
    local machine_count = (item and item.definition.type == "machines") and tostring(item.definition.machine_count) or ""
    local textfield_machines = flow_machines.add{type="textfield", text=machine_count,
        tags={mod="toby-planner", on_gui_text_changed="picker_amount_changed", on_gui_confirmed="picker_amount", width=machine_width},
        tooltip={"toby-planner.expression_textfield"}}
    textfield_machines.style.width = machine_width
    modal_elements["machine_count_textfield"] = textfield_machines

    local item_proto = (item) and item.proto or nil
    set_item_proto(modal_data, item_proto--[[@as FPItemPrototype?]])

    local belt_proto = (item and item.definition.type == "belts") and item.definition.belt_proto or nil
    set_belt_proto(modal_data, belt_proto--[[@as FPBeltPrototype?]])
    refresh_definition_controls(modal_data)

    if (item) then set_appropriate_focus(modal_data)
    else modal_elements.search_textfield.focus() end
    update_dialog_submit_button(modal_elements)
end


---@param player LuaPlayer
---@param tags SelectPickerItemTags
local function handle_item_pick(player, tags, _)
    local modal_data = lib.globals.modal_data(player)  ---@as PickerDialogModalData
    local item_proto = prototyper.util.find("items", tags.item_id, tags.category_id)  ---@as FPItemPrototype

    if not tags.enabled then
        lib.cursor.create_flying_text(player, {"toby-planner.picker_already_selected", item_proto.localised_name})
        return
   end

    set_item_proto(modal_data, item_proto)  -- no need for sync in this case
    refresh_definition_controls(modal_data)

    set_appropriate_focus(modal_data)
    update_dialog_submit_button(modal_data.modal_elements)
end

---@param player LuaPlayer
---@param event EventData.on_gui_elem_changed
local function handle_belt_pick(player, _, event)
    local belt_name = event.element.elem_value  ---@as string
    local belt_proto = prototyper.util.find("belts", belt_name, nil)  ---@as FPBeltPrototype

    local modal_data = lib.globals.modal_data(player)  ---@as PickerDialogModalData
    set_belt_proto(modal_data, belt_proto)  -- syncs amounts itself
    refresh_definition_controls(modal_data)

    set_appropriate_focus(modal_data)
    update_dialog_submit_button(modal_data.modal_elements)
end

---@param player LuaPlayer
---@param event EventData.on_gui_selection_state_changed
local function handle_belt_stack_change(player, _, event)
    local modal_data = lib.globals.modal_data(player)  ---@as PickerDialogModalData
    modal_data.belt_stack = event.element.selected_index  ---@as integer

    set_appropriate_focus(modal_data)
    sync_amounts(modal_data)
end


---@param player LuaPlayer
---@param modal_data PickerDialogModalData
local function open_picker_dialog(player, modal_data)
    local preferences = lib.globals.preferences(player)
    modal_data.timescale = preferences.timescale
    modal_data.belts_or_lanes = preferences.belts_or_lanes
    modal_data.belt_stack = preferences.belt_stack

    if modal_data.item_id then
        modal_data.item = OBJECT_INDEX[modal_data.item_id]  ---@as FactoryItem
        local definition = modal_data.item.definition
        if definition.type == "belts" then modal_data.belt_stack = definition.belt_stack end
    end

    local content_frame = modal_data.modal_elements.content_frame
    content_frame.style.minimal_width = 325
    content_frame.style.bottom_padding = 6
    add_item_pane(content_frame, modal_data, modal_data.item)

    -- The item picker only needs to show when adding a new item
    if modal_data.item_id == nil then
        local titlebar_flow = modal_data.modal_elements.titlebar_flow
        titlebar_flow.visible = true
        titlebar_flow.add{type="sprite-button", sprite="utility/tip_icon", style="toby_planner_button_frame",
            tooltip={"factoriopedia.show-unresearched"}, auto_toggle=true, toggled=preferences.show_unresearched_items,
            tags={mod="toby-planner", on_gui_click="toggle_picker_unresearched"}, mouse_button_filter={"left"}}

        local auxiliary_flow = modal_data.modal_elements.auxiliary_flow
        local picker_content_frame = auxiliary_flow.add{type="frame", direction="vertical", style="inside_deep_frame"}
        picker_content_frame.style.top_margin = 8
        add_item_picker(picker_content_frame, player)
        apply_item_filter(player, "")
    end
end

---@param player LuaPlayer
---@param action GUICloseAction
local function close_picker_dialog(player, action)
    local ui_state = lib.globals.ui_state(player)
    local modal_data = ui_state.modal_data  ---@as PickerDialogModalData
    local factory = lib.context.get(player, "Factory")  ---@as Factory

    if action == "submit" then
        local defined_by = modal_data.amount_defined_by
        local relevant_textfield_name = (defined_by == "machines") and "machine_count_textfield"
            or (((defined_by == "amount") and "item" or "belt") .. "_amount_textfield")
        local amount_textfield = modal_data.modal_elements[relevant_textfield_name]

        local relevant_amount = lib.gui.parse_expression_field(amount_textfield, true) or 0
        if defined_by == "amount" then
            -- Special items are entered in their own fixed unit, so they ignore the timescale
            if not modal_data.item_proto--[[@as FPItemPrototype]].special then
                relevant_amount = relevant_amount / modal_data.timescale
            end
            relevant_amount = math.max(relevant_amount, MAGIC_NUMBERS.margin_of_error * 10)
        elseif defined_by == "belts" and modal_data.belts_or_lanes == "lanes" then
            relevant_amount = relevant_amount * 0.5  -- lanes are stored as belts
        end

        local definition ---@type ItemDefinition
        if defined_by == "amount" then
            definition = {type="amount", amount=relevant_amount}
        elseif defined_by == "machines" then
            definition = {type="machines", machine_count=relevant_amount}
        else
            definition = {
                type="belts",
                belt_count=relevant_amount,
                belt_proto=modal_data.belt_proto--[[@as FPBeltPrototype]],
                belt_stack=modal_data.belt_stack
            }
        end

        if modal_data.item ~= nil then  -- ie. this is an edit
            modal_data.item.definition = definition
        else
            local item_proto = modal_data.item_proto
            local top_level_item = FactoryItem.init(item_proto)
            top_level_item.definition = definition

            if modal_data.create_factory then  -- if this flag is set, create a factory to put the item into
                factory = factory_list.add_factory(player, nil, item_proto)
            end

            factory:insert(top_level_item)
            lib.gui.run_refresh(player, "factory_list")  -- for product icons
        end

        solver.update(player, factory)
        main_dialog.toggle_districts_view(player, true)
        lib.gui.run_refresh(player, "production")

    elseif action == "delete" then  ---@cast modal_data.item -nil
        factory:remove(modal_data.item)
        solver.update(player, factory)
        lib.gui.run_refresh(player, "factory_list")  -- for product icons
        lib.gui.run_refresh(player, "production")
    end

    -- Remember selected group so it can be re-applied when the dialog is re-opened
    ui_state.last_selected_picker_group = modal_data.selected_group_id
end


-- ** EVENTS **
local listeners = {}  ---@type ListenerDefinitions

listeners.gui = {
    on_gui_checked_state_changed = {
        {
            name = "picker_toggle_machines",
            handler = function(player, _, event)
                ---@cast event EventData.on_gui_checked_state_changed
                local modal_data = lib.globals.modal_data(player)  ---@as PickerDialogModalData
                modal_data.amount_defined_by = event.element.state and "machines" or "amount"

                if event.element.state then
                    local modal_elements = modal_data.modal_elements
                    modal_elements.item_amount_textfield.text = ""
                    set_belt_proto(modal_data, nil)
                    modal_data.belt_stack = lib.globals.preferences(player).belt_stack
                    modal_elements.belt_stack_dropdown.selected_index = modal_data.belt_stack
                    lib.gui.update_expression_field(modal_elements.item_amount_textfield, true)
                    lib.gui.update_expression_field(modal_elements.belt_amount_textfield, true)
                end

                refresh_definition_controls(modal_data)
                set_appropriate_focus(modal_data)
                update_dialog_submit_button(modal_data.modal_elements)
            end
        }
    },
    on_gui_click = {
        {
            name = "toggle_picker_unresearched",
            handler = function(player, _, event)
                ---@cast event EventData.on_gui_click
                local preferences = lib.globals.preferences(player)
                preferences.show_unresearched_items = event.element.toggled
                modal_dialog.run_search(player)
            end
        },
        {
            name = "picker_item_choice",
            handler = function(player, _, _)
                local cursor_item = lib.cursor.parse_cursor_item(player)
                if cursor_item == nil then return end

                local item_proto = prototyper.util.find("items", cursor_item.name, "item")  ---@as FPItemPrototype?
                if item_proto == nil or item_proto.hidden or item_proto.ingredient_only then
                    local name = (item_proto) and item_proto.localised_name or {"toby-planner.this"}
                    local modal_data = lib.globals.modal_data(player)  ---@as PickerDialogModalData
                    lib.cursor.create_flying_text(player, {"toby-planner.picker_invalid_product", name,
                        {"toby-planner.pl_" .. modal_data.item_category, 1}})
                else
                    local factory = lib.context.get(player, "Factory")  ---@as Factory
                    local enabled = (factory:find({proto = item_proto}) == nil)
                    local tags = {item_id=item_proto.id, category_id=item_proto.category_id, enabled=enabled}
                    handle_item_pick(player, tags--[[@as SelectPickerItemTags]])
                end
            end
        },
        {
            name = "select_picker_item_group",
            handler = function(player, tags, _)
                ---@cast tags SelectPickerItemGroupTags
                local modal_data = lib.globals.modal_data(player)  ---@as PickerDialogModalData
                select_item_group(modal_data, tags.group_id)
            end
        },
        {
            name = "select_picker_item",
            handler = handle_item_pick
        }
    },
    on_gui_elem_changed = {
        {
            name = "picker_choose_belt",
            handler = handle_belt_pick
        }
    },
    on_gui_selection_state_changed = {
        {
            name = "picker_choose_belt_stack",
            handler = handle_belt_stack_change
        }
    },
    on_gui_text_changed = {
        {
            name = "picker_amount_changed",
            handler = function(player, _, event)
                ---@cast event EventData.on_gui_text_changed
                local amount = lib.gui.parse_expression_field(event.element, true)
                lib.gui.update_expression_field(event.element, amount ~= nil)

                update_dialog_submit_button(lib.globals.modal_elements(player))
            end
        },
        {
            name = "picker_belt_amount",
            handler = function(player, _, event)
                ---@cast event EventData.on_gui_text_changed
                local belt_amount = lib.gui.parse_expression_field(event.element, true)
                lib.gui.update_expression_field(event.element, belt_amount ~= nil)

                local modal_data = lib.globals.modal_data(player)  ---@as PickerDialogModalData
                sync_amounts(modal_data)  -- defined_by ~= "amount"
                update_dialog_submit_button(modal_data.modal_elements)
            end
        }
    },
    on_gui_confirmed = {
        {
            name = "picker_amount",
            handler = function(player, _, event)
                ---@cast event EventData.on_gui_confirmed
                local confirmed = lib.gui.confirm_expression_field(event.element, true)

                local item_proto = lib.globals.modal_data(player)--[[@as PickerDialogModalData]].item_proto
                local power_item = (item_proto) and lib.is_special_power_item(item_proto.name) or false

                if confirmed or power_item then lib.gui.close_dialog(player, "submit") end
            end
        }
    }
}  ---@as GUIListenerDefinition

listeners.dialog = {
    dialog = "picker",
    metadata = function(modal_data)
        ---@cast modal_data PickerDialogModalData
        local action = (modal_data.item_id) and {"toby-planner.edit"} or {"toby-planner.add"}
        return {
            caption = {"", action, " ", {"toby-planner.pl_" .. modal_data.item_category, 1}},
            search_handler_name = (not modal_data.item_id) and "apply_item_filter" or nil,
            disable_scroll_pane = true,
            show_submit_button = true,
            show_delete_button = (modal_data.item_id ~= nil)
        }  ---@as ModalDialogSettings
    end,
    open = open_picker_dialog,
    close = close_picker_dialog
}

listeners.global = {
    apply_item_filter = apply_item_filter
}

return { listeners }
