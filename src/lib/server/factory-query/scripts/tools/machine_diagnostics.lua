-- One crafting machine's current state and its stored ingredients and products.
local target = require("scripts.tools.target")
local bounded = require("scripts.tools.bounded")

local M = {}
M.manifest = {
  inspect_machine = {
    desc = "Inspect one built crafting machine at exact map coordinates: actual status, active state, recipe, progress, input/output inventories, fluids, modules, and electric connection. Stored ingredients are observations, not a throughput or bottleneck prediction. If ambiguous, use a returned unit_number.",
    tier = "2",
    params = {
      surface = "string! surface name or index", x = "number! map x", y = "number! map y",
      name = "string entity prototype name to disambiguate", unit_number = "integer entity unit number to disambiguate",
    },
  },
}

local CRAFTERS = { ["assembling-machine"] = true, furnace = true, ["rocket-silo"] = true }
local INPUT = {
  ["assembling-machine"] = defines.inventory.crafter_input or defines.inventory.assembling_machine_input,
  furnace = defines.inventory.crafter_input or defines.inventory.furnace_source,
  ["rocket-silo"] = defines.inventory.crafter_input or defines.inventory.rocket_silo_input,
}
local function items(inventory)
  if not inventory or not inventory.valid then return nil end
  local rows = inventory.get_contents()
  table.sort(rows, function(a, b)
    if a.count ~= b.count then return a.count > b.count end
    return a.name < b.name
  end)
  return { total_kinds = #rows, shown = math.min(#rows, 12), items = bounded.cut(rows, 12) }
end
local function status_name(value)
  for name, id in pairs(defines.entity_status) do
    if id == value then return name end
  end
  return tostring(value)
end
local function inspect_machine(a)
  local entity, miss, surface, force = target.find(a)
  if not entity then return miss end
  if not CRAFTERS[entity.type] then
    return { found = false, force = force.name, surface = surface.name,
      name = entity.name, reason = "entity is not a crafting machine" }
  end
  local recipe = entity.get_recipe()
  local row = {
    found = true, force = force.name, surface = surface.name,
    name = entity.name, type = entity.type, unit_number = entity.unit_number,
    x = entity.position.x, y = entity.position.y,
    status = entity.status and status_name(entity.status) or nil,
    active = entity.active, crafting = entity.is_crafting(),
    crafting_progress = bounded.round(entity.crafting_progress, 3),
    crafting_speed = bounded.round(entity.crafting_speed, 2),
    energy_j = bounded.round(entity.energy, 0),
    electric_network_id = entity.electric_network_id,
    connected_to_power_source = entity.is_connected_to_electric_network(),
    input = items(entity.get_inventory(INPUT[entity.type])),
    output = items(entity.get_output_inventory()),
    modules = items(entity.get_module_inventory()),
  }
  if recipe then
    row.recipe = { name = recipe.name, ingredients = recipe.ingredients, products = recipe.products }
  end
  local fluids = entity.get_fluid_contents()
  local fluid_rows = {}
  for name, amount in pairs(fluids) do fluid_rows[#fluid_rows + 1] = { name = name, amount = bounded.round(amount, 2) } end
  table.sort(fluid_rows, function(x, y) return x.name < y.name end)
  row.fluids = { total_kinds = #fluid_rows, fluids = bounded.cut(fluid_rows, 12) }
  return row
end
M.functions = { inspect_machine = inspect_machine }
return M
