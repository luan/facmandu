-- Read force-specific recipes and compatible base-speed crafting machines.
local force_lookup = require("scripts.tools.force_lookup")
local M = {}
local MAX_RECIPES = 12
local MAX_MACHINES = 24

M.manifest = {
  planning_recipes = {
    desc = "Recipes for one item or fluid in this save, including recipe unlock state, expected products, ingredients and prototype-compatible base-speed machines. Machine availability is owned (at least one exists), craftable (a placement-item recipe is enabled), unavailable, or unknown (no placement item). Read-only planning data; normal quality, no modules or beacons. A truncated result must not be used to select a recipe.",
    params = {
      product = "string! item or fluid prototype name",
      type = "string item or fluid; omit to search both",
    },
  },
}

local function ingredients(recipe)
  local rows = {}
  for _, part in pairs(recipe.ingredients) do
    rows[#rows + 1] = { name = part.name, type = part.type, amount = part.amount }
  end
  table.sort(rows, function(a, b) return a.name < b.name end)
  return rows
end

local function constrained(recipe)
  for _, part in pairs(recipe.ingredients) do
    if part.temperature or part.minimum_temperature or part.maximum_temperature
      or part.quality_min or part.quality_max or part.quality_change then return true end
  end
  for _, part in pairs(recipe.products) do
    if part.temperature or part.quality_min or part.quality_max or part.quality_change then return true end
  end
  return false
end

local function products(recipe, productivity)
  productivity = productivity or recipe.productivity_bonus
  local rows = {}
  for i, part in ipairs(recipe.products) do
    local amount
    if recipe.prototype.get_product_amount then
      amount = recipe.prototype.get_product_amount(i, productivity)
    else
      -- Factorio 2.0 lacks get_product_amount. This covers its ordinary and
      -- independently probabilistic products; shared rolls need 2.1's API.
      local base = (part.amount or ((part.amount_min + part.amount_max) / 2)) + (part.extra_count_fraction or 0)
      local probability = part.probability or 1
      local bonus = math.max(0, base - (part.ignored_by_productivity or part.ignored_by_stats or 0))
      amount = probability * (base + bonus * productivity)
    end
    rows[#rows + 1] = {
      name = part.name, type = part.type,
      -- 2.1 computes the exact expectation; 2.0 uses the fields above.
      amount = amount,
    }
  end
  table.sort(rows, function(a, b) return a.name < b.name end)
  return rows
end

local function machine_availability(force, prototype)
  if force.get_entity_count(prototype.name) > 0 then return "owned" end
  local place_items = prototype.items_to_place_this
  if not place_items or #place_items == 0 then return "unknown" end
  for _, item in pairs(place_items) do
    local matching = prototypes.get_recipe_filtered{{ filter = "has-product-item",
      elem_filters = {{ filter = "name", name = item.name }} }}
    for name in pairs(matching) do
      local recipe = force.recipes[name]
      if recipe and recipe.enabled then return "craftable" end
    end
  end
  return "unavailable"
end

local function machines(categories, force)
  local rows, seen = {}, {}
  for _, category in ipairs(categories) do
    local matching = prototypes.get_entity_filtered{{ filter = "crafting-category", crafting_category = category }}
    for name, prototype in pairs(matching) do
      if not seen[name] and (prototype.type == "assembling-machine" or prototype.type == "furnace" or prototype.type == "rocket-silo") then
        seen[name] = true
        local speed = prototype.get_crafting_speed()
        if speed and speed > 0 then
          local effect = prototype.effect_receiver and prototype.effect_receiver.base_effect
          rows[#rows + 1] = {
            name = name, speed = speed,
            productivity_bonus = effect and type(effect.productivity) == "number" and effect.productivity or 0,
          }
        end
      end
    end
  end
  table.sort(rows, function(a, b) return a.name < b.name end)
  local total = #rows
  while #rows > MAX_MACHINES do table.remove(rows) end
  for _, row in ipairs(rows) do
    row.availability = machine_availability(force, prototypes.entity[row.name])
  end
  return rows, total
end

local function planning_recipes(a)
  local force = force_lookup.require_force(a.force)
  if type(a.product) ~= "string" or a.product == "" then error("product is required", 0) end
  if a.type ~= nil and a.type ~= "item" and a.type ~= "fluid" then error("type must be item or fluid", 0) end
  local candidates = {}
  for _, recipe in pairs(force.recipes) do
    local matches = false
    -- Read product names first. Computing expected yields for every recipe
    -- made a live RCON lookup stall on large mod packs.
    for _, part in pairs(recipe.products) do
      if part.name == a.product and (a.type == nil or part.type == a.type) then matches = true end
    end
    if matches then candidates[#candidates + 1] = recipe end
  end
  table.sort(candidates, function(a, b)
    if a.enabled ~= b.enabled then return a.enabled end
    return a.name < b.name
  end)
  local total = #candidates
  local enabled_total = 0
  for _, recipe in ipairs(candidates) do if recipe.enabled then enabled_total = enabled_total + 1 end end
  local rows = {}
  local enabled_shown = 0
  for i = 1, math.min(total, MAX_RECIPES) do
    local recipe = candidates[i]
    if recipe.enabled then enabled_shown = enabled_shown + 1 end
    local categories = recipe.categories
    if not categories then
      categories = { recipe.category }
      for _, category in pairs(recipe.additional_categories or {}) do
        categories[#categories + 1] = category
      end
    end
    local available, total_machines = machines(categories, force)
    for _, machine in ipairs(available) do
      if machine.productivity_bonus ~= 0 then
        machine.products = products(recipe, recipe.productivity_bonus + machine.productivity_bonus)
      end
    end
    rows[#rows + 1] = {
      name = recipe.name, enabled = recipe.enabled, hidden = recipe.hidden,
      energy = recipe.energy, categories = categories,
      ingredients = ingredients(recipe), products = products(recipe),
      productivity_bonus = recipe.productivity_bonus,
      constrained = constrained(recipe),
      machines = available, machines_total = total_machines,
    }
  end
  return { force = force.name, product = a.product, type = a.type, recipes = rows,
           total = total, truncated = total > #rows,
           enabled_total = enabled_total, enabled_shown = enabled_shown }
end

M.functions = { planning_recipes = planning_recipes }
return M
