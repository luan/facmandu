-- Shared saved input definitions and independently configured production blocks.
local Planning = {}

local function finite(value, maximum)
    return type(value) == "number" and value == value and value >= 0 and value <= maximum
end

local function identity(item)
    if type(item) ~= "table" or type(item.name) ~= "string" then return false end
    if item.type ~= "item" and item.type ~= "fluid" and item.type ~= "entity" then return false end
    local proto = prototyper.util.find("items", item.name, item.type)
    return proto and (item.type ~= "entity" or (proto.special and lib.is_special_power_item(proto.name))) or false
end

-- Belt names survive prototype rebuilds; throughput is resolved when the plan is solved.
function Planning.input_amount(input)
    local definition = input.definition
    if not definition then return input.amount end
    if type(definition) ~= "table" or definition.type ~= "belts" or input.type ~= "item"
        or type(definition.belt) ~= "string" or definition.belt == "" then return nil end
    local belt = prototyper.util.find("belts", definition.belt)
    if not belt or not finite(definition.count, 1000000)
        or not finite(definition.stack, prototypes.utility_constants.max_belt_stack_size)
        or definition.stack < 1 or definition.stack % 1 ~= 0 then return nil end
    return definition.count * belt.throughput * definition.stack
end

function Planning.validate_inputs(inputs)
    -- Bound saved constraints to keep native edits and agent requests predictable.
    if type(inputs) ~= "table" or #inputs > 32 then return false end
    local seen, count = {}, 0
    for index, input in pairs(inputs) do
        count = count + 1
        if type(index) ~= "number" or index % 1 ~= 0 or index < 1 or index > #inputs
            or not identity(input) or (input.mode ~= "exact" and input.mode ~= "maximum") then return false end
        local amount = Planning.input_amount(input)
        local maximum = input.type == "entity" and 1e12 or 1000000 / 60
        if not finite(amount, maximum) then return false end
        local key = input.type .. "/" .. input.name
        if seen[key] then return false end
        seen[key] = true
    end
    return count == #inputs
end

function Planning.resolve_inputs(inputs)
    local resolved = lib.flib.deep_copy(inputs or {})
    for _, input in ipairs(resolved) do input.amount = Planning.input_amount(input) end
    return resolved
end

function Planning.validate(settings)
    if type(settings) ~= "table" or type(settings.linked) ~= "boolean"
        or (settings.mode ~= "output" and settings.mode ~= "input" and settings.mode ~= "machines")
        or not Planning.validate_inputs(settings.inputs) or type(settings.products) ~= "table"
        or #settings.products > 32 then return false end
    local count, seen = 0, {}
    for index, product in pairs(settings.products) do
        count = count + 1
        if type(index) ~= "number" or index % 1 ~= 0 or index < 1 or index > #settings.products
            or not identity(product) or not finite(Planning.input_amount(product), product.type == "entity" and 1e12 or 1000000 / 60)
            or (product.mode ~= nil and product.mode ~= "exact" and product.mode ~= "maximum") then return false end
        local key = product.type .. "/" .. product.name
        if seen[key] then return false end
        seen[key] = true
    end
    return count == #settings.products and (settings.maximize_product == nil or identity(settings.maximize_product))
end

function Planning.has_constraints(floor)
    if floor.planning then return true end
    for line in floor:iterator() do
        if line.class == "Floor" then
            if Planning.has_constraints(line) then return true end
        elseif line.machine_constraint then return true end
    end
    return false
end

return Planning
