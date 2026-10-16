--- How good is a layout? (FR1, FR2 in docs/05-requirements-mvp.md)
---   utilisation: machines the exact ratios need / machines placed (1 = nothing idle), per row and total
---   build cost:  the entities as items, and those items broken down into raw materials by the game's own
---                recipes (anything without an assembler recipe, e.g. plates and steel, counts as raw)
---   rate:        the planned output rate (the in-game test measures the real one)
--- All numbers are exact fractions where they can be.
local fraction = require("engine.model.fraction")

local score = {}

local PORTS = { ["interpose-input-port"] = true, ["interpose-output-port"] = true }

local function assembler_recipe(item, pack)
  local r = pack.recipes[item]
  if not r or r.category == "smelting" or #r.results ~= 1 or r.results[1].name ~= item then
    return nil
  end
  for _, ing in ipairs(r.ingredients) do
    if ing.type ~= "item" then
      return nil
    end
  end
  return r
end

--- Break `count` of `item` down into raw materials, adding to `raw` (item -> fraction).
local function to_raw(item, count, pack, raw, depth)
  local r = depth < 20 and assembler_recipe(item, pack)
  if not r then
    raw[item] = (raw[item] or fraction.new(0)) + count
    return
  end
  local crafts = count / r.results[1].amount
  for _, ing in ipairs(r.ingredients) do
    to_raw(ing.name, crafts * ing.amount, pack, raw, depth + 1)
  end
end

--- Score a solve result (engine/solve.lua). Returns {
---   rows = { {recipe, chain, machines_exact, machines, utilisation} }, utilisation,
---   entities = {name -> count}, raw = {item -> count}, raw_total, rate }
function score.of(result, pack)
  local rows, exact_total, placed_total = {}, fraction.new(0), 0
  local exact_by_recipe = {}
  for _, step in ipairs(result.plan.steps) do
    exact_by_recipe[step.recipe] = step.machines_exact
  end
  for _, row in ipairs(result.layout.rows) do
    local exact = exact_by_recipe[row.recipe]
    rows[#rows + 1] = {
      recipe = row.recipe,
      chain = row.copy, -- M12: which parallel chain (nil: the only one)
      machines_exact = exact,
      machines = row.machines,
      utilisation = exact / row.machines,
    }
    exact_total = exact_total + exact
    placed_total = placed_total + row.machines
  end

  local entities = {}
  for _, e in ipairs(result.blueprint.blueprint.entities) do
    if not PORTS[e.name] then
      entities[e.name] = (entities[e.name] or 0) + 1
    end
  end
  local raw, raw_total = {}, fraction.new(0)
  local names = {}
  for name in pairs(entities) do
    names[#names + 1] = name
  end
  table.sort(names)
  for _, name in ipairs(names) do
    to_raw(name, fraction.new(entities[name]), pack, raw, 0)
  end
  for _, n in pairs(raw) do
    raw_total = raw_total + n
  end
  return {
    rows = rows,
    utilisation = placed_total > 0 and exact_total / placed_total or fraction.new(0),
    entities = entities,
    raw = raw,
    raw_total = raw_total,
    rate = result.plan.steps[#result.plan.steps] and result.plan.steps[#result.plan.steps].rate,
  }
end

return score
