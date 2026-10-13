local function read_controls(modal_data)
    local inputs = {}
    for _, row in ipairs(modal_data.input_rows) do
        local text = row.amount.text
        if text:match("%S") then
            local amount = tonumber(text)
            if not amount or amount ~= amount or amount < 0 or amount > 1000000 then return end
            inputs[#inputs + 1] = {name=row.proto.name, type=row.proto.type, amount=amount / 60,
                mode=(row.mode.selected_index == 1) and "maximum" or "exact"}
        end
    end
    if #inputs > 32 then return end
    local maximize = modal_data.outputs[modal_data.output.selected_index]
    return inputs, maximize
end

local function validate_controls(player)
    local modal_data = lib.globals.modal_data(player)
    modal_data.modal_elements.dialog_submit_button.enabled = read_controls(modal_data) ~= nil
end

local function open_supply_dialog(player, modal_data)
    local factory = lib.context.get(player, "Factory")
    modal_data.factory = factory
    local content = modal_data.modal_elements.content_frame
    local explanation = content.add{type="label",
        caption="Set available inputs. Leave a rate blank for unrestricted supply. Uses Simplex."}
    explanation.style.single_line = false
    explanation.style.maximal_width = 600
    local rows = content.add{type="table", column_count=4}
    rows.style.horizontal_spacing = 16
    for _, caption in ipairs{"Input", "Available / min", "Consumption", "Current use / min"} do
        rows.add{type="label", caption=caption, style="bold_label"}
    end
    local limits, protos, seen = {}, {}, {}
    local function append(proto)
        local key = proto.type .. "/" .. proto.name
        if not seen[key] then protos[#protos + 1] = proto;seen[key] = true end
    end
    for _, input in ipairs(factory.inputs or {}) do
        limits[input.type .. "/" .. input.name] = input
        local proto = prototyper.util.find("items", input.name, input.type)
        append(proto or {name=input.name, type=input.type, sprite="utility/questionmark", localised_name=input.name .. " (unavailable; clear to remove)"})
    end
    for _, item in ipairs(factory.top_floor.ingredients) do
        if item.proto.type == "item" or item.proto.type == "fluid" then append(item.proto) end
    end
    modal_data.input_rows = {}
    local consumed = {}
    for _, item in ipairs(factory.top_floor.ingredients) do
        consumed[item.proto.type .. "/" .. item.proto.name] = item.amount * 60
    end
    for _, proto in ipairs(protos) do
        local limit = limits[proto.type .. "/" .. proto.name]
        local identity = rows.add{type="flow", direction="horizontal"}
        identity.add{type="sprite", sprite=proto.sprite}
        identity.add{type="label", caption=proto.localised_name}
        local amount = rows.add{type="textfield", text=limit and tostring(limit.amount * 60) or "",
            numeric=true, allow_decimal=true, allow_negative=false,
            tags={mod="toby-planner", on_gui_text_changed="supply_value"}}
        local mode = rows.add{type="drop-down", items={"Use at most", "Use exactly"},
            selected_index=(limit and limit.mode == "exact") and 2 or 1}
        local used = consumed[proto.type .. "/" .. proto.name] or 0
        local usage = lib.format.number(used, 3) .. " used"
        if limit then usage = usage .. " · " .. lib.format.number(math.max(0, limit.amount * 60 - used), 3) .. " unused" end
        rows.add{type="label", caption=usage}
        modal_data.input_rows[#modal_data.input_rows + 1] = {proto=proto, amount=amount, mode=mode}
    end
    local goal = content.add{type="flow", direction="horizontal"}
    goal.add{type="label", caption="Output goal"}
    local names = {"Keep current product targets"}
    modal_data.outputs = {}
    local selected = 1
    for product in factory:iterator() do
        if product.proto.type == "item" or product.proto.type == "fluid" then
            names[#names + 1] = {"", "Maximize ", product.proto.localised_name}
            modal_data.outputs[#names] = {name=product.proto.name, type=product.proto.type}
            if factory.maximize_product and factory.maximize_product.name == product.proto.name
                    and factory.maximize_product.type == product.proto.type then selected = #names end
        end
    end
    modal_data.output = goal.add{type="drop-down", items=names, selected_index=selected}
    validate_controls(player)
end

local function close_supply_dialog(player, action)
    if action ~= "submit" then return end
    local modal_data = lib.globals.modal_data(player)
    local inputs, maximize = read_controls(modal_data)
    if not inputs or not modal_data.factory:set_constraints(inputs, maximize) then return end
    solver.update(player, modal_data.factory)
    lib.gui.run_refresh(player, "production")
end

return {{
    gui={on_gui_click={{name="edit_supply", handler=function(player)
        local factory = lib.context.get(player, "Factory")
        if factory then lib.gui.open_dialog(player, {dialog="supply"}) end
    end}}, on_gui_text_changed={{name="supply_value", handler=validate_controls}}},
    dialog={dialog="supply", metadata=function()
        return {caption="Input supply", subheader_text="Constrain inputs and calculate the achievable output.",
            show_submit_button=true}
    end, open=open_supply_dialog, close=close_supply_dialog}
}}
