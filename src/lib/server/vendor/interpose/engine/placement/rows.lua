--- Stage 3 (F4a): row-template placement. One row of identical machines per recipe, in plan order
--- (input side first). Each row, top to bottom:
---
---   input belt   (flows east, carries the recipe's ingredients, at most 2: one per lane)
---   inserters    (belt -> machine, one per machine)
---   machines     (w x h each, side by side)
---   inserters    (machine -> belt, one per machine)
---   output belt  (flows east, carries the result)
---
--- A recipe with 3 or 4 ingredients gets a second input belt above the first (M10), taken by
--- long-handed inserters that reach over the inner belt:
---
---   outer belt   (one ingredient from behind; a fourth may be side-loaded from above)
---   inner belt   (two ingredients, both side-loaded onto its first tile, one from each side)
---   inserters    (regular ones take from the inner belt, long-handed ones from the outer)
---   machines ... (as above)
---
--- Rows are separated by one empty tile row, and a margin is kept around the block: routing (M5) runs
--- the port connections there.
---
--- Power (M11): with tiers.pole (a 1x1 pole), each row leaves a free column in its machine band before
--- the first machine, after every m machines and after the last, with a pole in it at the machines'
--- middle row, so the pole reaches the inserters above and below. m: as many machines as one pole's
--- supply area can bridge to the next pole (small pole: 1, medium: 2). The planner adds the rest.
---
--- Throughput: an inserter moves one item per swing (no stack bonus: no research assumed), so
--- items/s = 60 * rotation_speed, of which rows.INSERTER_EFFICIENCY is planned (picking from a moving
--- belt is slower than chest to chest). Each machine gets as many inserters per side as its share of
--- the row's input and output needs, up to one per tile column. If that is not enough, the row gets
--- more machines than crafting alone needs, so the planned rate is still met.
local direction = require("engine.model.direction")
local fraction = require("engine.model.fraction")
local issues = require("engine.issues")
local origin_mod = require("engine.placement.origin")

local rows = {}

rows.MARGIN = 2 -- free tiles left of, right of and above the rows, for routing
rows.MACHINE_GAP = 0
rows.GAP = 2 -- free tile rows between two rows: one for the item coming back, one for side-loading
rows.INSERTER_EFFICIENCY = fraction.new(4, 5)

--- Items per second one inserter of this prototype is planned to move.
function rows.inserter_rate(inserter)
  return fraction.from(inserter.rotation_speed) * 60 * rows.INSERTER_EFFICIENCY
end

--- Tile columns (0-based within a machine of width w) for k inserters: centre first, then outwards.
local function inserter_columns(w, k, centre_first)
  local order, centre = {}, math.floor(w / 2)
  order[1] = centre
  for d = 1, w do
    if centre - d >= 0 then
      order[#order + 1] = centre - d
    end
    if centre + d < w then
      order[#order + 1] = centre + d
    end
  end
  local cols = {}
  for i = 1, k do
    cols[i] = order[i]
  end
  if not centre_first then
    table.sort(cols)
  end
  return cols
end

local function entity(list, name, x, y, dir, extra)
  local e = { entity_number = #list + 1, name = name, position = { x = x, y = y } }
  if dir and dir ~= direction.NORTH then
    e.direction = dir
  end
  for k, v in pairs(extra or {}) do
    e[k] = v
  end
  list[#list + 1] = e
  return e
end

--- Place the rows for a solved plan (engine/ratios.solve) and a loaded problem (engine/problem.load).
--- Returns layout or nil, issues. layout = {
---   entities = blueprint entities (machines, inserters, row belts), entity_number 1..n,
---   rows = { {recipe, item, ingredients, machines, x, width, input_belt = {x1, x2, y}, output_belt = {...}} },
---   size = {w, h} tiles used including margins, origin = {x, y} top-left tile of the rows }
--- A step's recipe as the row sees it: a furnace row of burner furnaces also takes fuel, as one more
--- ingredient (amount: fuel per craft).
function rows.recipe_of(step, pack)
  local recipe = pack.recipes[step.recipe]
  if not step.fuel then
    return recipe
  end
  local crafts = step.rate / recipe.results[1].amount
  local ingredients = {}
  for i, ing in ipairs(recipe.ingredients) do
    ingredients[i] = ing
  end
  if crafts > fraction.new(0) then
    ingredients[#ingredients + 1] = { type = "item", name = step.fuel.item, amount = step.fuel.rate / crafts }
  end
  return { ingredients = ingredients, results = recipe.results, time = recipe.time, category = recipe.category }
end

--- The machine prototype and name of a step's row: its furnace, or the assembler tier.
function rows.machine_of(step, problem, pack)
  if step.furnace then
    return pack.furnaces[step.furnace], step.furnace
  end
  return pack.machines[problem.tiers.machine], problem.tiers.machine
end

--- Which belt and lane each ingredient of a recipe travels on. made: set of items rows make (they
--- arrive on one lane; supplies from input ports fill both). Returns {
---   inner = {names} (1 or 2), merge = both inner ones side-loaded onto a lead tile,
---   outer_behind = name or nil, outer_side = name or nil (3-4 ingredients: the outer belt),
---   lead = belt tiles before the machines, alone = {name = true} for ingredients that have a belt
---   to themselves (both lanes) } or nil, issue.
function rows.belts_for(recipe_name, recipe, made)
  local list = {}
  for _, ing in ipairs(recipe.ingredients) do
    list[#list + 1] = { name = ing.name, amount = ing.amount }
  end
  -- biggest amount first, then by name
  table.sort(list, function(a, b)
    if a.amount ~= b.amount then
      return a.amount > b.amount
    end
    return a.name < b.name
  end)
  local function names(from, to)
    local out = {}
    for i = from, to do
      out[#out + 1] = list[i].name
    end
    table.sort(out)
    return out
  end
  local n = #list
  if n <= 2 then
    local inner = names(1, n)
    local merge = n == 2 and not made[inner[1]] and not made[inner[2]]
    return { inner = inner, merge = merge, lead = merge and 1 or 0, alone = n == 1 and { [inner[1]] = true } or {} }
  elseif n == 3 then
    -- the biggest has the outer belt to itself
    return {
      inner = names(2, 3),
      merge = true,
      outer_behind = list[1].name,
      lead = 2,
      alone = { [list[1].name] = true },
    }
  elseif n == 4 then
    -- the outer belt's back lane must hold one item only: one made by a row (it is on one lane)
    local behind
    for i = 1, n do
      if made[list[i].name] and not behind then
        behind = i
      end
    end
    if not behind then
      return nil,
        issues.new(
          "too-many-ingredients",
          string.format(
            "recipe %s has 4 ingredients, all from input ports; the layout must make one of them",
            recipe_name
          ),
          "remove the input port of one intermediate ingredient, so the layout makes it"
        )
    end
    local rest = {}
    for i = 1, n do
      if i ~= behind then
        rest[#rest + 1] = list[i]
      end
    end
    local inner = { rest[2].name, rest[3].name }
    table.sort(inner)
    return {
      inner = inner,
      merge = true,
      outer_behind = list[behind].name,
      outer_side = rest[1].name,
      lead = 2,
      alone = {},
    }
  end
  return nil,
    issues.new(
      "too-many-ingredients",
      string.format("recipe %s has %d ingredients; two input belts carry at most 4", recipe_name, n),
      "add input ports for some of its ingredients' products, or pick another output"
    )
end

-- "max" plans each lane at most this full: a lane at 100% loses items where belts join and inserters
-- pick, so the layout would not reach its plan (measured in-game: 88% of a 100% plan, golden test)
rows.MAX_LANE_USE = fraction.new(9, 10)

--- The highest output rate the belt tier allows for a plan made at an output rate of 1 item/s: every
--- row's ingredients and product must fit their lanes (the same limits rows.place checks), each lane
--- used at most rows.MAX_LANE_USE. Exact. copies (M12, default 1): the chain is built that many times
--- side by side, each copy with its own belts; the input ports still bring one belt each.
--- Second value: what sets the limit, {kind = "input" | "ingredient" | "product", item, recipe}.
function rows.max_rate(unit_plan, problem, pack, copies)
  copies = copies or 1
  local lane = fraction.from(pack.belts[problem.tiers.belt].items_per_second) / 2 * rows.MAX_LANE_USE
  local best, why
  local function limit(capacity, per_unit, reason)
    if per_unit > fraction.new(0) then
      local r = capacity / per_unit
      if not best or r < best then
        best, why = r, reason
      end
    end
  end
  -- a supply several rows use comes in on one belt (and is split there): it carries the total
  for _, inp in ipairs(unit_plan.inputs) do
    limit(lane * 2, inp.rate, { kind = "input", item = inp.item })
  end
  local made = {}
  for _, step in ipairs(unit_plan.steps) do
    made[step.item] = true
  end
  for _, step in ipairs(unit_plan.steps) do
    local recipe = rows.recipe_of(step, pack)
    local crafts = step.rate / recipe.results[1].amount
    local belts = rows.belts_for(step.recipe, recipe, made) or { alone = {} }
    for _, ing in ipairs(recipe.ingredients) do
      limit(
        (belts.alone[ing.name] and lane * 2 or lane) * copies,
        crafts * ing.amount,
        { kind = "ingredient", item = ing.name, recipe = step.recipe }
      )
    end
    -- the product of each chain on one lane; the final product's chains share the output belt's two lanes
    local is_output = false
    for _, o in ipairs(problem.outputs or { problem.output }) do
      is_output = is_output or o.item == step.item
    end
    local lanes = is_output and math.min(copies, 2) or copies
    limit(lane * lanes, step.rate, { kind = "product", item = step.item, recipe = step.recipe })
  end
  return best or lane, why
end

--- M12: a plan built as `copies` parallel chains: every step once per copy, each at its share of the
--- rate (step.copy = 1..copies; copy-major order, so each chain's rows stay together).
function rows.split(plan, copies)
  local steps = {}
  for j = 1, copies do
    for _, step in ipairs(plan.steps) do
      local s = {}
      for k, v in pairs(step) do
        s[k] = v
      end
      s.copy = j
      s.rate = step.rate / copies
      s.machines_exact = step.machines_exact / copies
      s.machines = fraction.ceil(s.machines_exact)
      if step.fuel then
        s.fuel = { item = step.fuel.item, rate = step.fuel.rate / copies }
      end
      steps[#steps + 1] = s
    end
  end
  local out = {}
  for k, v in pairs(plan) do
    out[k] = v
  end
  out.steps, out.copies = steps, copies
  return out
end

--- M11: how many machines of width w and height h go between two poles of this supply, or nil when a
--- pole in a gap column cannot reach the inserter rows (then the row gets no room for poles).
function rows.pole_spacing(supply, w, h)
  local span = math.floor(2 * supply) -- the furthest two poles may stand apart and still cover all between
  local m = math.floor((span - 1) / w)
  local yc = math.floor((h - 1) / 2) -- the pole's row within the machine band
  -- it must reach the inserter rows: from -1 (above the machines) to h (below), counting 0.35 into a tile
  local reach_up = yc + 0.5 - supply < -1 + 0.65
  local reach_down = yc + 0.5 + supply > h + 0.35
  if m >= 1 and reach_up and reach_down then
    return m, yc
  end
  return nil
end

function rows.place(plan, problem, pack)
  local tiers = problem.tiers
  local errors = {}
  local pole = problem.pole_room and tiers.pole and pack.poles[tiers.pole]
  local cap = rows.inserter_rate(pack.inserters[tiers.inserter])
  local long = tiers.long_inserter and pack.inserters[tiers.long_inserter]
  local cap_long = long and rows.inserter_rate(long)
  local belt = pack.belts[tiers.belt]
  local lane = fraction.from(belt.items_per_second) / 2

  -- a supply several rows use comes in on one belt, both lanes (fans split it, engine/placement/fan)
  for _, inp in ipairs(plan.inputs) do
    if inp.rate > lane * 2 then
      errors[#errors + 1] = issues.new(
        "belt-too-slow",
        string.format(
          "the rows need %s %s/s in all, more than one %s carries (%s/s)",
          tostring(inp.rate),
          inp.item,
          tiers.belt,
          tostring(lane * 2)
        ),
        "pick a faster belt tier, or a lower output rate"
      )
    end
  end
  local made = {}
  for _, step in ipairs(plan.steps) do
    made[step.item] = true
  end

  -- pass 1: size every row
  local sized, widest = {}, 0
  for _, step in ipairs(plan.steps) do
    local recipe = rows.recipe_of(step, pack)
    local machine, machine_name = rows.machine_of(step, problem, pack)
    local w, h = machine.size[1], machine.size[2]
    local ingredients = {}
    for _, ing in ipairs(recipe.ingredients) do
      ingredients[#ingredients + 1] = ing.name
    end
    table.sort(ingredients)
    local belts, problem_issue = rows.belts_for(step.recipe, recipe, made)
    if not belts then
      errors[#errors + 1] = problem_issue
      belts = { inner = {}, lead = 0, alone = {} }
    elseif belts.outer_behind and not cap_long then
      errors[#errors + 1] = issues.new(
        "unknown-tier",
        string.format("recipe %s needs a second input belt, and no long-handed inserter is known", step.recipe),
        "add tiers.long_inserter to the problem"
      )
    end
    -- items per second through the row's input and output inserters (outer belt: long-handed ones)
    local crafts = step.rate / recipe.results[1].amount
    local items_in, items_outer = fraction.new(0), fraction.new(0)
    for _, ing in ipairs(recipe.ingredients) do
      local per_item = crafts * ing.amount
      if ing.name == belts.outer_behind or ing.name == belts.outer_side then
        items_outer = items_outer + per_item
      else
        items_in = items_in + per_item
      end
      -- each ingredient travels on one lane (one that has a belt to itself may use both)
      local limit = belts.alone[ing.name] and lane * 2 or lane
      if per_item > limit then
        errors[#errors + 1] = issues.new(
          "belt-too-slow",
          string.format(
            "row %s needs %s %s/s, more than a %s lane carries (%s/s)",
            step.recipe,
            tostring(per_item),
            ing.name,
            tiers.belt,
            tostring(limit)
          ),
          "pick a faster belt tier, or a lower output rate"
        )
      end
    end
    local items_out = step.rate
    if items_out > lane then
      errors[#errors + 1] = issues.new(
        "belt-too-slow",
        string.format(
          "row %s makes %s %s/s, more than a %s lane carries (%s/s)",
          step.recipe,
          tostring(items_out),
          step.item,
          tiers.belt,
          tostring(lane)
        ),
        "pick a faster belt tier, or a lower output rate"
      )
    end
    local n = math.max(step.machines, fraction.ceil(items_in / (cap * w)), fraction.ceil(items_out / (cap * w)))
    local per_gap, pole_row = nil, nil
    if pole then
      per_gap, pole_row = rows.pole_spacing(pole.supply, w, h)
    end
    local k_in = math.max(1, fraction.ceil(items_in / n / cap))
    local k_out = math.max(1, fraction.ceil(items_out / n / cap))
    local k_long = 0
    if belts.outer_behind and cap_long then
      -- regular and long-handed inserters share the machine's columns: more machines until both fit
      while true do
        k_in = math.max(1, fraction.ceil(items_in / n / cap))
        k_long = math.max(1, fraction.ceil(items_outer / n / cap_long))
        if k_in + k_long <= w then
          break
        end
        n = n + 1
      end
      k_out = math.max(1, fraction.ceil(items_out / n / cap))
    end
    -- the inner belt's ingredients are side-loaded from both sides onto its first tile when they
    -- would fill both lanes, or when the outer belt is above it (engine/routing nets)
    local merge, lead = belts.merge, belts.lead
    local both = inserter_columns(w, k_in + k_long, true)
    local cols_in, cols_long = {}, {}
    for i, c in ipairs(both) do
      if i <= k_in then
        cols_in[#cols_in + 1] = c
      else
        cols_long[#cols_long + 1] = c
      end
    end
    table.sort(cols_in)
    table.sort(cols_long)
    sized[#sized + 1] = {
      step = step,
      ingredients = ingredients,
      items_in = items_in,
      items_out = items_out,
      n = n,
      k_in = k_in,
      k_out = k_out,
      cols_in = cols_in,
      cols_long = cols_long,
      cols_out = inserter_columns(w, k_out),
      merge = merge,
      lead = lead,
      belts = belts,
      items_outer = items_outer,
      height = belts.outer_behind and h + 5 or h + 4,
      w = w,
      h = h,
      machine_name = machine_name,
      per_gap = per_gap, -- M11: machines between pole columns (nil: no room for poles)
      pole_row = pole_row,
    }
    if rows.EXACT_MACHINES and n ~= step.machines then
      errors[#errors + 1] = issues.new("inserter-capacity", "the selected inserters cannot serve the saved machine counts", "change the logistics or inserters, or revise the plan in the planner")
    end
    -- room for poles: one column before the machines, one after every per_gap of them
    local gaps = (per_gap and (1 + math.ceil(n / per_gap)) or 0) + (n - 1) * rows.MACHINE_GAP
    sized[#sized].gaps = gaps
    widest = math.max(widest, lead + n * w + gaps)
  end
  if #errors > 0 then
    return nil, errors
  end

  -- where the block goes
  local block_h = (#sized - 1) * rows.GAP
  for _, r in ipairs(sized) do
    block_h = block_h + r.height
  end
  -- a corridor west of the block, one column per belt that enters a row there (problem.west_room:
  -- solve's fallback when the belts did not get through)
  local west = rows.MARGIN
  if problem.west_room then
    local arrivals = 0
    for _, r in ipairs(sized) do
      arrivals = arrivals + #r.ingredients
    end
    west = math.max(rows.MARGIN, arrivals + 1)
  end
  -- M12: three or more chains stand side by side as columns, each chain's rows stacked; between two
  -- columns a corridor for the belts leaving the left one (one per row) and entering the right one
  -- (one per ingredient of its rows)
  local copies = plan.copies or 1
  local col_off, columns = {}, copies >= 3
  if columns then
    local chain_w, chain_h, arrivals, leaving = {}, {}, {}, {}
    for _, r in ipairs(sized) do
      local j = r.step.copy
      chain_w[j] = math.max(chain_w[j] or 0, r.lead + r.n * r.w + r.gaps)
      chain_h[j] = (chain_h[j] or -rows.GAP) + r.height + rows.GAP
      arrivals[j] = (arrivals[j] or 0) + #r.ingredients
      leaving[j] = (leaving[j] or 0) + 1
    end
    -- columns left to right; when they would be wider than the area, the rest go in a band below
    local area_w = problem.area[2][1] - problem.area[1][1]
    local room = area_w - 2 * rows.MARGIN - (problem.west_room and arrivals[1] + 1 or rows.MARGIN)
    local x, band_y, band_h = 0, 0, 0
    widest, block_h = 0, 0
    for j = 1, copies do
      local gap = j > 1 and math.max(rows.MARGIN, leaving[j - 1] + arrivals[j] + 1) or 0
      if j > 1 and x + gap + chain_w[j] > room then
        -- a new band: below the last, with a corridor for the belts between them
        band_y = band_y + band_h + rows.GAP + 6
        x, band_h, gap = 0, 0, 0
      end
      x = x + gap
      col_off[j] = { x = x, y = band_y }
      x = x + chain_w[j]
      band_h = math.max(band_h, chain_h[j])
      widest = math.max(widest, x)
      block_h = math.max(block_h, band_y + band_h)
    end
    if problem.west_room then
      west = math.max(rows.MARGIN, arrivals[1] + 1)
    end
  end
  local need_w, need_h = west + rows.MARGIN + widest, 2 * rows.MARGIN + block_h
  local area_w = problem.area[2][1] - problem.area[1][1]
  local area_h = problem.area[2][2] - problem.area[1][2]
  if need_w > area_w or need_h > area_h then
    local too_small = issues.new(
      "area-too-small",
      string.format(
        "the machines need %d wide x %d tall (with room for belts); the area is %d wide x %d tall",
        need_w,
        need_h,
        area_w,
        area_h
      ),
      "make the area larger, or lower the output rate"
    )
    too_small.size = { w = need_w, h = need_h } -- the mod remembers it and checks the next selection
    return nil, { too_small }
  end
  -- an input port several rows use gets a fan of splitters in front of it (engine/placement/fan):
  -- keep the block clear of the room it may take, k tiles deep and k to either side for k users
  local users = {}
  for _, r in ipairs(sized) do
    for _, item in ipairs(r.ingredients) do
      users[item] = (users[item] or 0) + 1
    end
  end
  local avoid = {}
  for _, inp in ipairs(problem.inputs) do
    local k = users[inp.item] or 0
    if k >= 2 then
      local v = direction.vector(inp.direction)
      local fx, fy = math.floor(inp.position.x) + v.x, math.floor(inp.position.y) + v.y
      local x1, x2 = math.min(fx, fx + v.x * k), math.max(fx, fx + v.x * k)
      local y1, y2 = math.min(fy, fy + v.y * k), math.max(fy, fy + v.y * k)
      if v.x == 0 then
        x1, x2 = x1 - k, x2 + k
      else
        y1, y2 = y1 - k, y2 + k
      end
      avoid[#avoid + 1] = { x = x1, y = y1, w = x2 - x1 + 1, h = y2 - y1 + 1 }
    end
  end
  local origin = origin_mod.choose(problem, widest, block_h, rows.MARGIN, avoid, west)
  if not origin and west > rows.MARGIN then
    origin = origin_mod.choose(problem, widest, block_h, rows.MARGIN, avoid) -- no room for the corridor
  end
  if not origin then
    return nil,
      {
        issues.new(
          "ports-in-the-way",
          string.format(
            "no spot of %d wide x %d tall for the machines stays clear of the ports%s",
            need_w,
            need_h,
            #(problem.obstacles or {}) > 0 and " and obstacles" or ""
          ),
          #(problem.obstacles or {}) > 0
              and "move the ports to the edges of the area, clear some obstacles, or make the area larger"
            or "move the ports to the edges of the area, or make the area larger"
        ),
      }
  end

  -- pass 2: emit the entities
  local x0, y = origin[1], origin[2]
  local layout = { entities = {}, rows = {}, size = { need_w, need_h }, origin = { x = x0, y = y } }
  local ents = layout.entities
  local chain_y = {}
  for _, r in ipairs(sized) do
    if columns then
      -- each chain in its own column, its rows stacked from the top
      local j = r.step.copy
      x0 = origin[1] + col_off[j].x
      y = chain_y[j] or (origin[2] + col_off[j].y)
    end
    local w, h = r.w, r.h
    local width = r.n * w + r.gaps
    local xm = x0 + r.lead -- the machines' first column
    local outer = r.belts.outer_behind ~= nil
    local yo = y -- outer belt (two-belt rows)
    if outer then
      y = y + 1
      for i = 0, width - 1 do
        entity(ents, tiers.belt, xm + i + 0.5, yo + 0.5, direction.EAST)
      end
    end
    local yb_in, yi_in, ym, yi_out, yb_out = y, y + 1, y + 2, y + 2 + h, y + 3 + h
    for i = -r.lead, width - 1 do
      entity(ents, tiers.belt, xm + i + 0.5, yb_in + 0.5, direction.EAST)
    end
    -- M11: the machines' left columns, with the pole columns between them
    local lefts = {}
    local x = xm
    for k = 0, r.n - 1 do
      if r.per_gap and k % r.per_gap == 0 then
        entity(ents, tiers.pole, x + 0.5, y + 2 + r.pole_row + 0.5)
        x = x + 1
      end
      lefts[k] = x
      x = x + w + (k < r.n - 1 and rows.MACHINE_GAP or 0)
    end
    if r.per_gap then
      entity(ents, tiers.pole, x + 0.5, y + 2 + r.pole_row + 0.5)
    end
    for k = 0, r.n - 1 do
      local left = lefts[k]
      -- inserters face north: pickup north, drop south (verified against the game in L2)
      for _, c in ipairs(r.cols_in) do
        entity(ents, tiers.inserter, left + c + 0.5, yi_in + 0.5, direction.NORTH, rows.INPUT_SETTINGS)
      end
      for _, c in ipairs(r.cols_long) do
        entity(ents, tiers.long_inserter, left + c + 0.5, yi_in + 0.5, direction.NORTH, rows.INPUT_SETTINGS)
      end
      -- a furnace picks its recipe from what it gets
      local extra = not r.step.furnace and { recipe = r.step.recipe } or nil
      entity(ents, r.machine_name, left + w / 2, ym + h / 2, direction.NORTH, extra)
      for _, c in ipairs(r.cols_out) do
        entity(ents, tiers.inserter, left + c + 0.5, yi_out + 0.5, direction.NORTH, rows.OUTPUT_SETTINGS)
      end
    end
    for i = 0, width - 1 do
      entity(ents, tiers.belt, xm + i + 0.5, yb_out + 0.5, direction.EAST)
    end
    layout.rows[#layout.rows + 1] = {
      copy = r.step.copy, -- M12: which parallel chain (nil: the only one)
      recipe = r.step.recipe,
      machine = r.machine_name,
      item = r.step.item,
      ingredients = r.ingredients,
      machines = r.n,
      machines_for_crafting = r.step.machines, -- fewer than `machines` when inserters limit the row
      inserters = { input = #r.cols_in, long = #r.cols_long, output = r.k_out }, -- per machine
      items_in = r.items_in,
      items_out = r.items_out,
      x = lefts[0], -- the first machine's first column
      width = width,
      merge = r.merge or nil, -- both ingredients side-loaded onto the input belt's first tile
      outer_behind = r.belts.outer_behind, -- 3-4 ingredients: from behind onto the outer belt
      outer_side = r.belts.outer_side, -- 4 ingredients: side-loaded onto the outer belt
      inner = r.belts.inner, -- the ingredients on the input (inner) belt
      outer_belt = outer and { x1 = xm, x2 = xm + width - 1, y = yo } or nil,
      last_first_machine_long_x = outer and lefts[0] + r.cols_long[#r.cols_long] or nil,
      first_inserter_x = lefts[0] + r.cols_in[1], -- tile column of the first input inserter
      last_first_machine_inserter_x = lefts[0] + r.cols_in[#r.cols_in], -- last input inserter of machine 1
      input_belt = { x1 = x0, x2 = xm + width - 1, y = yb_in },
      output_belt = { x1 = xm, x2 = xm + width - 1, y = yb_out },
    }
    y = y + h + 4 + rows.GAP
    if columns then
      chain_y[r.step.copy] = y
    end
  end
  return layout, {}
end

return rows
