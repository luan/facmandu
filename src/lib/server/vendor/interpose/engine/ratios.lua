--- Stage 1 of the layout engine: machine counts from recipe data. No modules, base crafting speed only.
local fraction = require("engine.model.fraction")
local issues = require("engine.issues")

local ratios = {}

--- Exact number of machines needed to produce `rate` items per second:
---   n = (r * t) / (a * s)
--- r: items/s wanted, t: recipe time (s), a: result amount per craft, s: machine crafting speed.
--- Arguments may be numbers, decimal strings or fractions. Returns a fraction; use fraction.ceil
--- for whole machines.
function ratios.machines_exact(rate, recipe_time, result_amount, crafting_speed)
  local r, t = fraction.from(rate), fraction.from(recipe_time)
  local a, s = fraction.from(result_amount), fraction.from(crafting_speed)
  return (r * t) / (a * s)
end

--- Whole machines needed: ceil of machines_exact.
function ratios.machines_needed(rate, recipe_time, result_amount, crafting_speed)
  return fraction.ceil(ratios.machines_exact(rate, recipe_time, result_amount, crafting_speed))
end

--- Pick the recipe that makes `item` in `machine`: the recipe named like the item if it qualifies,
--- else the only qualifying one. Returns name, recipe or nil, error.
local function recipe_for(item, machine, pack)
  local candidates = {}
  for name, r in pairs(pack.recipes) do
    local makes = false
    for _, res in ipairs(r.results) do
      makes = makes or (res.name == item and res.type == "item")
    end
    local allowed = false
    for _, c in ipairs(machine.categories) do
      allowed = allowed or c == r.category
    end
    if makes and allowed then
      candidates[#candidates + 1] = name
    end
  end
  table.sort(candidates)
  for _, name in ipairs(candidates) do
    if name == item then
      return name, pack.recipes[name]
    end
  end
  if #candidates == 1 then
    return candidates[1], pack.recipes[candidates[1]]
  elseif #candidates == 0 then
    return nil, nil
  end
  return nil,
    issues.new(
      "alternative-recipes",
      "several recipes make " .. item .. " (" .. table.concat(candidates, ", ") .. ")",
      "add an input port for " .. item .. "; choosing between recipes is not supported yet"
    )
end

--- Solve the recipe tree for a loaded problem (engine/problem.lua).
--- Returns plan or nil, errors. plan = {
---   steps  = { {recipe, item, rate, machines_exact, machines, depth}, ... } (sorted: inputs side first),
---   inputs = { {item, rate}, ... } (sorted by item),
---   machine = name, crafting_speed }
--- Rates and machines_exact are fractions; machines is the whole count.
function ratios.solve(problem, pack)
  local machine = pack.machines[problem.tiers.machine]
  local speed = fraction.from(machine.crafting_speed)
  -- furnaces (M10): smelt what an assembler cannot make, when its ingredients can be had
  local furnace_name = problem.tiers.furnace
  local furnace = furnace_name and (pack.furnaces or {})[furnace_name]
  local supplied = {}
  for _, inp in ipairs(problem.inputs) do
    supplied[inp.item] = true
  end
  -- can this item be had: supplied, or made (by an assembler or a furnace) from things that can?
  local function obtainable(item, seen)
    if supplied[item] then
      return true
    end
    if seen[item] then
      return false
    end
    seen[item] = true
    for _, m in ipairs({ machine, furnace or false }) do
      if m then
        local name, r = recipe_for(item, m, pack)
        if name then
          ---@cast r -nil
          local all = true
          for _, ing in ipairs(r.ingredients) do
            all = all and ing.type == "item" and obtainable(ing.name, seen)
          end
          if all then
            seen[item] = nil
            return true
          end
        end
      end
    end
    seen[item] = nil
    return false
  end

  local errors = {}
  local leaves = {} -- auto inputs: items nobody supplies that the machine cannot make
  local recipes, depth = {}, {} -- item -> {name, recipe}; item -> longest distance from the target
  local visiting = {}

  -- discover the tree; depth = longest path from target, so every item is solved after all its users
  local function visit(item, d)
    if supplied[item] then
      return
    end
    if visiting[item] then
      errors[#errors + 1] =
        issues.new("recipe-loop", "the recipes loop through " .. item, "add an input port for " .. item)
      return
    end
    if depth[item] and depth[item] >= d then
      return
    end
    depth[item] = d
    if not recipes[item] then
      local name, r = recipe_for(item, machine, pack)
      local smelt = false
      if not name and not r and furnace and not problem.auto_inputs then
        local fname, fr = recipe_for(item, furnace, pack)
        if fname then
          ---@cast fr -nil
          local all = true
          for _, ing in ipairs(fr.ingredients) do
            all = all and ing.type == "item" and obtainable(ing.name, {})
          end
          if all then
            name, r, smelt = fname, fr, true
          end
        end
      end
      if not name then
        if r then
          errors[#errors + 1] = r
        elseif problem.auto_inputs and d > 0 and not r then
          -- auto inputs (M9e): what the machine cannot make comes in through an input port
          supplied[item] = true
          leaves[#leaves + 1] = item
          depth[item] = nil
        elseif d == 0 then
          errors[#errors + 1] = issues.new(
            "output-not-craftable",
            problem.tiers.machine .. " cannot make " .. item,
            "pick an output an assembling machine can craft, or another machine tier"
          )
        else
          -- an ingredient nobody supplies and the machine cannot make: the inputs are not sufficient
          errors[#errors + 1] = issues.new(
            "missing-input",
            "nothing supplies " .. item .. ", and " .. problem.tiers.machine .. " cannot make it",
            "add an input port for " .. item
          )
        end
        return
      end
      ---@cast r -nil
      if #r.results ~= 1 then
        errors[#errors + 1] = issues.new(
          "byproducts",
          "recipe " .. name .. " makes more than one product",
          "add an input port for " .. item .. "; byproducts are not supported yet"
        )
        return
      end
      recipes[item] = { name = name, recipe = r, smelt = smelt or nil }
    end
    visiting[item] = true
    for _, ing in ipairs(recipes[item].recipe.ingredients) do
      if ing.type ~= "item" then
        errors[#errors + 1] = issues.new(
          "fluid-ingredient",
          "recipe " .. recipes[item].name .. " needs the fluid " .. ing.name,
          "add an input port for " .. item .. "; fluids are not supported yet"
        )
      else
        visit(ing.name, d + 1)
      end
    end
    visiting[item] = nil
  end
  local outputs = problem.outputs or { problem.output }
  for _, o in ipairs(outputs) do
    visit(o.item, 0)
  end
  for _, o in ipairs(outputs) do
    if supplied[o.item] then
      errors = { issues.new("output-is-input", "the output item is also an input", "remove that input port") }
    end
  end
  if #errors > 0 then
    -- one issue per code and message, in a stable order
    local seen, unique = {}, {}
    for _, e in ipairs(errors) do
      local k = e.code .. "\0" .. e.message
      if not seen[k] then
        seen[k] = true
        unique[#unique + 1] = e
      end
    end
    table.sort(unique, function(a, b)
      if a.code ~= b.code then
        return a.code < b.code
      end
      return a.message < b.message
    end)
    return nil, unique
  end

  -- propagate demand from the target down, in order of depth
  local order = {}
  for item in pairs(recipes) do
    order[#order + 1] = item
  end
  table.sort(order, function(a, b)
    if depth[a] ~= depth[b] then
      return depth[a] < depth[b]
    end
    return a < b
  end)
  -- the fuel burner furnaces burn: an input port's item that is a fuel they take (first by name)
  local fuel
  if furnace and furnace.fuel_categories then
    local names = {}
    for item in pairs(supplied) do
      local f = (pack.fuels or {})[item]
      for _, c in ipairs(f and furnace.fuel_categories or {}) do
        if c == f.category then
          names[#names + 1] = item
        end
      end
    end
    table.sort(names)
    fuel = names[1]
  end
  local demand = {}
  for _, o in ipairs(outputs) do
    demand[o.item] = (demand[o.item] or fraction.new(0)) + o.rate
  end
  local steps = {}
  local needs_fuel = false
  for _, item in ipairs(order) do
    local rate = demand[item] or fraction.new(0)
    local r = recipes[item].recipe
    local smelt = recipes[item].smelt
    local s = smelt and fraction.from(furnace.crafting_speed) or speed
    local exact = ratios.machines_exact(rate, r.time, r.results[1].amount, s)
    local crafts = rate / r.results[1].amount -- crafts per second
    for _, ing in ipairs(r.ingredients) do
      demand[ing.name] = (demand[ing.name] or fraction.new(0)) + crafts * ing.amount
    end
    local step_fuel
    if smelt and furnace.fuel_categories then
      if fuel then
        -- burnt while working: the furnaces' power times the share of time they work
        local per_second = fraction.from(furnace.energy_usage) * exact / fraction.from(pack.fuels[fuel].value)
        step_fuel = { item = fuel, rate = per_second }
        demand[fuel] = (demand[fuel] or fraction.new(0)) + per_second
      else
        needs_fuel = true
      end
    end
    steps[#steps + 1] = {
      item = item,
      recipe = recipes[item].name,
      rate = rate,
      machines_exact = exact,
      machines = fraction.ceil(exact),
      depth = depth[item],
      furnace = smelt and furnace_name or nil, -- smelted: the machine is this furnace
      fuel = step_fuel, -- {item, rate}: burner furnaces' fuel
    }
  end
  if needs_fuel then
    return nil,
      {
        issues.new(
          "missing-fuel",
          furnace_name .. "s burn fuel, and no input port supplies any",
          "add an input port for coal (or wood, solid fuel), or pick electric furnaces in the mod settings"
        ),
      }
  end
  -- inputs side first: deepest steps first
  local plan_steps = {}
  for i = #steps, 1, -1 do
    plan_steps[#plan_steps + 1] = steps[i]
  end

  local inputs = {}
  for _, inp in ipairs(problem.inputs) do
    inputs[#inputs + 1] = { item = inp.item, rate = demand[inp.item] or fraction.new(0) }
  end
  table.sort(leaves)
  for _, item in ipairs(leaves) do
    inputs[#inputs + 1] = { item = item, rate = demand[item] or fraction.new(0) }
  end
  table.sort(inputs, function(a, b)
    return a.item < b.item
  end)
  local warnings = {}
  for _, inp in ipairs(inputs) do
    if inp.rate == fraction.new(0) then
      warnings[#warnings + 1] = issues.new(
        "unused-input",
        "the input port for " .. inp.item .. " is not needed",
        "remove it, or check the output item"
      )
    end
  end
  return {
    steps = plan_steps,
    inputs = inputs,
    machine = problem.tiers.machine,
    crafting_speed = speed,
    warnings = warnings,
    leaves = leaves, -- auto inputs: the items input ports must supply
  }, {}
end

return ratios
