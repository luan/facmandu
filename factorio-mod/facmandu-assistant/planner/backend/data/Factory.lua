local Object = require("planner.backend.data.Object")
local Planning = require("planner.backend.data.Planning")
local Floor = require("planner.backend.data.Floor")
local FactoryItem = require("planner.backend.data.FactoryItem")

---@class Factory: Object, ObjectMethods
---@field class "Factory"
---@field parent District
---@field next Factory?
---@field previous Factory?
---@field archived boolean
---@field name string
---@field blueprints_inventory LuaInventory
---@field notes string
---@field productivity_boni table<string, IntegerEffectValue>
---@field inputs InputLimit[]
---@field maximize_product {name: string, type: string}?
---@alias InputLimit {name: string, type: string, amount: number, mode: "exact" | "maximum"}
---@field first FactoryItem?
---@field top_floor Floor
---@field tick_of_deletion uint?
---@field tick_of_solver_update uint?
---@field last_valid_modset ModToVersion?
local Factory = Object.methods()
Factory.__index = Factory
script.register_metatable("Factory", Factory)

---@param name string?
---@param solver_name SolverName
---@return Factory
local function init(name, solver_name)
    local object = Object.init({
        archived = false,
        --owner = nil,
        --shared = false,

        name = name,
        blueprints_inventory = game.create_inventory(MAGIC_NUMBERS.blueprint_limit),
        notes = "",
        productivity_boni = {},
        inputs = {},
        first = nil,
        top_floor = Floor.init(1, solver_name),

        tick_of_deletion = nil,
        tick_of_solver_update = nil,
        last_valid_modset = nil
    }, "Factory", Factory)  ---@as Factory
    object.top_floor.parent = object
    return object
end


function Factory:index()
    OBJECT_INDEX[self.id] = self
    for product in self:iterator() do product:index() end
    self.top_floor:index()
end


---@param product FactoryItem
---@param relative_object FactoryItem?
---@param direction NeighbourDirection?
function Factory:insert(product, relative_object, direction)
    product.parent = self
    self:_insert(product, relative_object, direction)
end

---@param product FactoryItem
function Factory:remove(product)
    if self.maximize_product and self.maximize_product.name == product.proto.name
            and self.maximize_product.type == product.proto.type then self.maximize_product = nil end
    product.parent = nil
    self:_remove(product)
end

---@param product FactoryItem
---@param new_product FactoryItem
function Factory:replace(product, new_product)
    if self.maximize_product and self.maximize_product.name == product.proto.name
            and self.maximize_product.type == product.proto.type then self.maximize_product = nil end
    product.parent = nil
    new_product.parent = self
    self:_replace(product, new_product)
end

---@param product FactoryItem
---@param direction NeighbourDirection
---@param spots integer?
function Factory:shift(product, direction, spots)
    self:_shift(product, direction, spots)
end


---@param filter ObjectFilter
---@param pivot FactoryItem?
---@param direction NeighbourDirection?
---@return FactoryItem? product
function Factory:find(filter, pivot, direction)
    return self:_find(filter, pivot, direction)  ---@as FactoryItem?
end

---@return FactoryItem?
function Factory:find_last()
    return self:_find_last()  ---@as FactoryItem?
end


---@param filter ObjectFilter?
---@param pivot FactoryItem?
---@param direction NeighbourDirection?
---@return fun(): FactoryItem?
function Factory:iterator(filter, pivot, direction)
    return self:_iterator(filter, pivot, direction)
end

---@param filter ObjectFilter?
---@param pivot FactoryItem?
---@param direction NeighbourDirection?
---@return FactoryItem[]
function Factory:as_list(filter, pivot, direction)
    return self:_as_list(filter, pivot, direction)
end

---@param filter ObjectFilter?
---@param pivot FactoryItem?
---@param direction NeighbourDirection?
---@return number count
function Factory:count(filter, pivot, direction)
    return self:_count(filter, pivot, direction)
end


---@param attach_products boolean
---@param export_format boolean
---@return LocalisedString caption
---@return LocalisedString? tooltip
function Factory:tostring(attach_products, export_format)
    local caption, tooltip = self.name, nil  -- don't return a tooltip for the export_format

    if attach_products and self.valid then
        local product_string = ""
        for product in self:iterator() do
            product_string = product_string .. "[img=" .. product.proto.sprite .. "]"
        end
        if product_string ~= "" then product_string = product_string .. "  " end
        caption = product_string .. caption
    end

    if not export_format then
        local status_string = ""
        if self.tick_of_deletion then status_string = status_string .. "[img=toby_planner_trash_red] " end
        if not self.valid then status_string = status_string .. "[img=toby_planner_warning_red] " end
        caption = status_string .. caption

        local trashed_string = ""  ---@type LocalisedString
        if self.tick_of_deletion then
            local ticks_left_in_trash = self.tick_of_deletion - game.tick
            local minutes_left_in_trash = math.ceil(ticks_left_in_trash / 3600)
            trashed_string = {"toby-planner.factory_trashed", minutes_left_in_trash}
        end

        local invalid_string = (not self.valid) and {"toby-planner.factory_invalid"} or ""
        tooltip = {"", {"toby-planner.tt_title", caption}, trashed_string, invalid_string}
    end

    return caption, tooltip
end


---@param force LuaForce
---@param recipe_name string
---@return IntegerEffectValue productivity_bonus
function Factory:get_productivity_bonus(force, recipe_name)
    local custom_bonus = self.productivity_boni[recipe_name]
    if custom_bonus then return custom_bonus
    else return lib.effects.get_recipe_productivity(force, recipe_name) end
end


---@param desired_tick MapTick
---@param player LuaPlayer
function Factory:schedule_solver_update(desired_tick, player)
    -- Get rid of any previously scheduled refreshes
    if self.tick_of_solver_update then
        lib.nth_tick.cancel(self.tick_of_solver_update)
        self.tick_of_solver_update = nil
    end

    ---@class UpdateSolverMetadata
    ---@field player_index PlayerIndex
    ---@field factory_id ObjectID
    local metadata = {player_index=player.index, factory_id=self.id}

    local actual_tick = lib.nth_tick.register(desired_tick, "update_solver", metadata)
    self.tick_of_solver_update = actual_tick
end


---@param player LuaPlayer
---@param starting_tick MapTick?
---@return MapTick? running_tick
function Factory:refresh_lines(player, starting_tick)
    if not self.top_floor:refresh_lines(player) then return starting_tick end

    self:validate(player)  -- lines only repair themselves, validity is determined from here
    if not starting_tick then return nil end  -- callers that re-solve on their own pass no tick

    -- Keep the selected factory's data consistent until its scheduled UI refresh
    if lib.context.get(player, "Factory") == self then solver.update(player, self) end

    self:schedule_solver_update(starting_tick, player)
    return starting_tick + MAGIC_NUMBERS.factory_solver_update_delay
end

function Factory:clear_solver_cache()
    self.top_floor:clear_solver_cache()
end

-- Inputs use the same temperature-specific prototype names as the native solver.
-- Limit: 32 constraints at up to 1,000,000/min; raise after native large-plan profiling.
local function validate_constraints(factory, inputs, maximize_product)
    if not Planning.validate_inputs(inputs) then return false end
    if maximize_product then
        if type(maximize_product) ~= "table" or type(maximize_product.name) ~= "string"
                or (maximize_product.type ~= "item" and maximize_product.type ~= "fluid" and maximize_product.type ~= "entity")
                or not prototyper.util.find("items", maximize_product.name, maximize_product.type) then return false end
    end
    return true
end

function Factory:set_constraints(inputs, maximize_product)
    if not validate_constraints(self, inputs, maximize_product) then return false end
    self.inputs = Planning.resolve_inputs(inputs)
    self.maximize_product = maximize_product and lib.flib.shallow_copy(maximize_product)
    if maximize_product then
        local proto = prototyper.util.find("items", maximize_product.name, maximize_product.type)
        if not self:find({proto=proto}) then self:insert(FactoryItem.init(proto)) end
    end
    if #inputs > 0 or maximize_product then self.top_floor.solver = "simplex" end
    return true
end


---@class PackedFactory: PackedObject
---@field class "Factory"
---@field name string
---@field blueprint_strings table<integer, string> sparse
---@field notes string
---@field productivity_boni table<string, IntegerEffectValue>
---@field products PackedFactoryItem[]
---@field top_floor PackedFloor

---@param full boolean
---@return PackedFactory packed_self
function Factory:pack(full)
    local blueprint_strings = {}
    for index = 1, #self.blueprints_inventory do
        local item = self.blueprints_inventory[index]  ---@as LuaItemStack
        if item.valid_for_read then
            blueprint_strings[index] = item.export_stack()
        end
    end

    return {
        class = self.class,
        name = self.name,
        blueprint_strings = blueprint_strings,
        notes = self.notes,
        productivity_boni = self.productivity_boni,
        inputs = lib.flib.deep_copy(self.inputs or {}),
        planning_mode = self.planning_mode,
        maximize_product = self.maximize_product and lib.flib.shallow_copy(self.maximize_product),
        products = self:_pack(full),
        top_floor = self.top_floor:pack(full)
    }
end

---@param packed_self PackedFactory
---@return Factory factory
local function unpack(packed_self)
    local unpacked_self = init(packed_self.name, packed_self.top_floor.solver)

    unpacked_self.blueprints_inventory = game.create_inventory(MAGIC_NUMBERS.blueprint_limit)
    for index, blueprint in pairs(packed_self.blueprint_strings) do
        unpacked_self.blueprints_inventory[index].import_stack(blueprint)
    end

    unpacked_self.notes = packed_self.notes
    unpacked_self.productivity_boni = packed_self.productivity_boni
    unpacked_self.inputs = lib.flib.deep_copy(packed_self.inputs or {})
    unpacked_self.planning_mode = packed_self.planning_mode
    unpacked_self.maximize_product = packed_self.maximize_product and lib.flib.shallow_copy(packed_self.maximize_product)

    unpacked_self.first = Object.unpack(packed_self.products, FactoryItem.unpack, unpacked_self)  ---@as FactoryItem

    unpacked_self.top_floor = Floor.unpack(packed_self.top_floor)
    unpacked_self.top_floor.parent = unpacked_self

    return unpacked_self
end

---@param player LuaPlayer
---@return Factory clone
function Factory:clone(player)
    local clone = unpack(self:pack(false))
    clone:validate(player)
    return clone
end


---@param player LuaPlayer
---@return boolean valid
function Factory:validate(player)
    local previous_validity = self.valid
    self.valid = true

    self.valid = self:_validate(player) and self.valid
    self.valid = self.top_floor:validate(player) and self.valid
    self.valid = validate_constraints(self, self.inputs or {}, self.maximize_product) and self.valid

    -- Remove any invalid boni, no need to mark the factory as invalid
    for recipe_name, _ in pairs(self.productivity_boni) do
        if not PRODUCTIVITY_RECIPES[recipe_name] then
            self.productivity_boni[recipe_name] = nil
        end
    end

    if self.valid then self.last_valid_modset = nil
    -- If this factory became invalid with the current configuration, retain the modset before the current one
    -- The one in storage.planner is still the previous one as it's only updated after migrations
    elseif previous_validity and not self.valid then self.last_valid_modset = storage.planner.installed_mods end

    return self.valid  ---@as boolean
end

---@param player LuaPlayer
---@return boolean success
function Factory:repair(player)
    self:_repair(player)
    self.top_floor:repair(player)

    self.last_valid_modset = nil
    self.valid = validate_constraints(self, self.inputs or {}, self.maximize_product)
    return self.valid
end

return {init = init, unpack = unpack}
