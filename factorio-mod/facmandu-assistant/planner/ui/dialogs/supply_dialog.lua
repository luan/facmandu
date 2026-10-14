local Planning = require("planner.backend.data.Planning")

local modes = {"output", "input", "machines"}
local function prototype(row)
    return prototyper.util.find("items", row.name, row.type)
end

local function save_controls(modal)
    modal.draft.mode = modes[modal.mode.selected_index]
    modal.draft.linked = not modal.link or modal.link.state
    modal.draft.maximize_product = modal.outputs[modal.output.selected_index]
end

local function amount_text(player, row)
    local amount = Planning.input_amount(row)
    if amount == nil then return "Unavailable" end
    if row.type == "entity" then
        local _, text = lib.format.special_amount(row.name, amount)
        return text
    end
    return lib.format.number(amount * lib.globals.preferences(player).timescale, 3)
end

local function render_rows(player, modal, category)
    local rows = modal[category .. "_table"]
    rows.clear()
    for _, caption in ipairs{"", "Item", "Configured", "Target", category == "inputs" and "Used" or "Produced", "", ""} do
        rows.add{type="label", caption=caption, style="bold_label"}
    end
    local usage = {}
    local current = category == "inputs" and modal.floor.ingredients or modal.floor.products
    for _, item in ipairs(current) do usage[item.proto.type .. "/" .. item.proto.name] = item.amount end
    for index, row in ipairs(modal.draft[category]) do
        local proto = prototype(row)
        local tags = {mod="toby-planner", on_gui_click="supply_pick", category=category, row=index}
        rows.add{type="sprite-button", sprite=proto and proto.sprite or "utility/questionmark",
            style="toby_flib_slot_button_blue", tags=tags, tooltip=proto and proto.tooltip or row.name}
        rows.add{type="label", caption=proto and proto.localised_name or row.name}
        local definition = row.definition
        local quantity = amount_text(player, row)
        if definition then
            quantity = {"", lib.format.number(definition.count, 3), " [entity=", definition.belt,
                "] × ", definition.stack, " · ", quantity}
        end
        local button = rows.add{type="button", caption=quantity, tags=tags, style="toby_planner_button_frame_tool",
            tooltip="Edit the rate, belt, stack size or exact/maximum target."}
        button.style.minimal_width = 90
        rows.add{type="label", caption=row.mode == "exact" and "Exactly" or "At most"}
        local used = usage[row.type .. "/" .. row.name] or 0
        local label = rows.add{type="label", caption=amount_text(player, {name=row.name, type=row.type, amount=used})}
        label.tooltip = category == "inputs" and {"", "Used; unused supply: ", amount_text(player,
            {name=row.name, type=row.type, amount=math.max(0, (Planning.input_amount(row) or 0) - used)})} or "Produced"
        rows.add{type="sprite-button", sprite="utility/add", style="tool_button",
            tooltip=category == "inputs" and "Apply settings and add a recipe that consumes this input."
                or "Apply settings and add a recipe that produces this output.",
            tags={mod="toby-planner", on_gui_click="supply_recipe", category=category, row=index}, enabled=proto ~= nil}
        rows.add{type="sprite-button", sprite="utility/trash", style="tool_button", tooltip="Remove this target",
            tags={mod="toby-planner", on_gui_click="supply_remove", category=category, row=index}}
    end
end

local function refresh_controls(player)
    local modal = lib.globals.modal_data(player)
    save_controls(modal)
    modal.modal_elements.dialog_submit_button.enabled = Planning.validate(modal.draft)
    modal.note.caption = modal.floor.level > 1 and modal.draft.linked
        and "Output quantities define this block's proportions. The parent scales them; input and machine limits remain absolute."
        or modal.draft.mode == "input"
        and "Choose an exact input to consume, or maximize an output with limited supplies."
        or modal.draft.mode == "machines" and "Set operating counts in the machine buttons. Blank counts remain unrestricted."
        or "Set product targets in the planner. Exact block targets must be met; maximum targets may leave capacity unused."
end

local function open_supply_dialog(player, modal)
    local factory = lib.context.get(player, "Factory")
    local floor = modal.floor_id and OBJECT_INDEX[modal.floor_id] or factory.top_floor
    local owner = floor
    while owner and owner.class == "Floor" do owner = owner.parent end
    if owner ~= factory then floor = factory.top_floor end
    modal.factory, modal.floor = factory, floor
    if modal.draft_revision and (modal.draft_revision ~= (factory.revision or 0) or modal.draft_factory_id ~= factory.id) then
        modal.draft = nil
        player.print("This plan changed while the picker was open. Its latest settings are shown.")
    end
    modal.draft = modal.draft or lib.flib.deep_copy(floor.planning or {
        mode=floor.level == 1 and (factory.maximize_product and "input" or factory.planning_mode or "output") or "machines",
        linked=true, products={}, inputs=floor.level == 1 and factory.inputs or {},
        maximize_product=floor.level == 1 and factory.maximize_product or nil})
    local content = modal.modal_elements.content_frame
    content.style.minimal_width = 620
    local header = content.add{type="flow", direction="horizontal"}
    header.style.vertical_align = "center"
    header.add{type="label", caption="Plan from", style="bold_label"}
    local selected = 1
    for i, mode in ipairs(modes) do if mode == modal.draft.mode then selected = i end end
    modal.mode = header.add{type="drop-down", items={"Output targets", "Available inputs", "Operating machines"},
        selected_index=selected, tags={mod="toby-planner", on_gui_selection_state_changed="supply_settings"}}
    if floor.level > 1 then
        modal.link = header.add{type="checkbox", caption="Scale with parent", state=modal.draft.linked,
            tooltip="Linked blocks scale to the parent's demand, within their limits. Unlinked blocks keep their configured quantities.",
            tags={mod="toby-planner", on_gui_checked_state_changed="supply_link"}}
    end
    modal.note = content.add{type="label"}
    modal.note.style.single_line = false
    modal.note.style.maximal_width = 620
    modal.note.style.bottom_margin = 12
    for _, category in ipairs(floor.level > 1 and {"products", "inputs"} or {"inputs"}) do
        local heading = content.add{type="flow", direction="horizontal"}
        heading.style.vertical_align = "center"
        heading.add{type="label", caption=category == "inputs" and "Available inputs" or "Block outputs", style="caption_label"}
        heading.add{type="empty-widget", style="toby_flib_horizontal_pusher"}
        heading.add{type="button", caption=category == "inputs" and "Add input" or "Add output",
            style="toby_planner_button_frame_tool", tags={mod="toby-planner", on_gui_click="supply_pick", category=category}}
        local rows = content.add{type="table", column_count=7}
        rows.style.horizontal_spacing = 12
        rows.style.vertical_spacing = 4
        rows.style.bottom_margin = 12
        modal[category .. "_table"] = rows
        render_rows(player, modal, category)
    end
    local goal = content.add{type="flow", direction="horizontal"}
    goal.style.vertical_align = "center"
    goal.add{type="label", caption="Output goal", style="bold_label"}
    local names = {"Keep configured targets / counts"}
    modal.outputs = {}
    local seen, selection = {}, 1
    local function add(proto)
        if not proto then return end
        local key = proto.type .. "/" .. proto.name
        if seen[key] then return end
        seen[key] = true
        names[#names + 1] = {"", "Maximize ", proto.localised_name}
        modal.outputs[#names] = {name=proto.name, type=proto.type}
        local maximize = modal.draft.maximize_product
        if maximize and maximize.type == proto.type and maximize.name == proto.name then selection = #names end
    end
    if modal.draft.maximize_product then add(prototype(modal.draft.maximize_product)) end
    if floor.level == 1 then for product in factory:iterator() do add(product.proto) end end
    for _, item in ipairs(floor.products) do add(item.proto) end
    for _, item in ipairs(floor.byproducts) do add(item.proto) end
    for _, product in ipairs(modal.draft.products) do add(prototype(product)) end
    modal.output = goal.add{type="drop-down", items=names, selected_index=selection,
        tags={mod="toby-planner", on_gui_selection_state_changed="supply_settings"}}
    goal.add{type="button", caption="Choose output", style="toby_planner_button_frame_tool",
        tags={mod="toby-planner", on_gui_click="supply_pick", category="maximize"}}
    content.add{type="label", caption={"", "Rates use ", {"toby-planner." .. lib.gui.timescale_as_string(lib.globals.preferences(player).timescale)},
        "; power uses watts. Item buttons open the native picker."}}
    if floor.level > 1 then
        content.add{type="button", caption="Restore defining-recipe scaling", style="toby_planner_button_frame_tool",
            tags={mod="toby-planner", on_gui_click="supply_restore"}}
    end
    refresh_controls(player)
end

local function close_supply_dialog(player, action)
    if action ~= "submit" then return end
    local modal = lib.globals.modal_data(player)
    save_controls(modal)
    local draft = modal.draft
    if not Planning.validate(draft) then return end
    if modal.floor.level == 1 then
        if not modal.factory:set_constraints(draft.inputs, draft.maximize_product) then return end
        modal.factory.planning_mode = draft.mode
    else
        local settings = not modal.restore and draft or nil
        if not modal.floor:set_planning(settings) then return end
    end
    solver.update(player, modal.factory)
    lib.gui.run_refresh(player, "all")
end

local function pick_supply(player, tags)
    local modal = lib.globals.modal_data(player)
    save_controls(modal)
    local data = {supply_draft=modal.draft, supply_floor_id=modal.floor.id, supply_revision=modal.shared_revision,
        supply_target=tags.category == "inputs" and "input" or tags.category == "maximize" and "maximize" or "output",
        supply_index=tags.row, item_category=tags.category == "inputs" and "ingredient" or "product"}
    lib.gui.close_dialog(player, "cancel")
    lib.gui.open_dialog(player, {dialog="picker", modal_data=data})
end

local function keyboard_planning(player, category)
    local state = lib.globals.ui_state(player)
    local factory = lib.context.get(player, "Factory")
    if not factory or factory.archived then return end
    if not state.modal_dialog_type and main_dialog.is_in_focus(player) then
        lib.gui.open_dialog(player, {dialog="supply", modal_data={floor_id=lib.context.get(player, "Floor").id}})
    end
    if lib.globals.ui_state(player).modal_dialog_type == "supply" and category then pick_supply(player, {category=category}) end
end

return {{
    gui={on_gui_click={
        {name="edit_supply", handler=function(player)
            local factory = lib.context.get(player, "Factory")
            if factory and not factory.archived then
                lib.gui.open_dialog(player, {dialog="supply", modal_data={floor_id=factory.top_floor.id}})
            end
        end},
        {name="edit_block_settings", handler=function(player)
            local factory = lib.context.get(player, "Factory")
            if factory and factory.valid and not factory.archived then
                lib.gui.open_dialog(player, {dialog="supply", modal_data={floor_id=lib.context.get(player, "Floor").id}})
            end
        end},
        {name="supply_pick", handler=pick_supply},
        {name="supply_remove", handler=function(player, tags)
            local modal = lib.globals.modal_data(player)
            table.remove(modal.draft[tags.category], tags.row)
            render_rows(player, modal, tags.category)
            refresh_controls(player)
        end},
        {name="supply_recipe", handler=function(player, tags)
            local modal = lib.globals.modal_data(player)
            save_controls(modal)
            if not Planning.validate(modal.draft) then return end
            local proto = prototype(modal.draft[tags.category][tags.row])
            lib.context.set(player, modal.floor)
            modal.next_dialog = {dialog="recipe", modal_data={production_type=tags.category == "inputs" and "consume" or "produce",
                category_id=proto.category_id, product_id=proto.id}}
            lib.gui.close_dialog(player, "submit")
        end},
        {name="supply_restore", handler=function(player)
            lib.globals.modal_data(player).restore = true
            lib.gui.close_dialog(player, "submit")
        end}
    }, on_gui_selection_state_changed={{name="supply_settings", handler=refresh_controls}},
       on_gui_checked_state_changed={{name="supply_link", handler=refresh_controls}}},
    dialog={dialog="supply", metadata=function(modal)
        local floor = modal and modal.floor_id and OBJECT_INDEX[modal.floor_id]
        return {caption=floor and floor.level > 1 and "Block planning" or "Factory planning",
            subheader_text="Plan by outputs, supplies or machines.", show_submit_button=true}
    end, open=open_supply_dialog, close=close_supply_dialog},
    player={
        toby_planner_add_input=function(player) keyboard_planning(player, "inputs") end,
        toby_planner_choose_output=function(player) keyboard_planning(player, "maximize") end,
        toby_planner_block_planning=function(player) keyboard_planning(player) end
    }
}}
