--- Validation stage 5b: item flow. Builds a graph (belt -> next tile, underground pairs, inserter
--- pickup -> drop, machine ingredients -> results), pushes items forward from the input ports to a
--- fixed point, then checks every machine gets its ingredients and every output port gets its item.
--- Belt lanes are not modelled yet: a belt is one carrier.
local blueprint = require("engine.blueprint")
local direction = require("engine.model.direction")

local flow = {}

local CARRIERS = { belt = true, underground = true }

local function at(grid, x, y)
  return grid[blueprint.tile_key(math.floor(x), math.floor(y))]
end

local function sorted_keys(set)
  local out = {}
  for k in pairs(set) do
    out[#out + 1] = k
  end
  table.sort(out)
  return out
end

local function problem(list, code, e, message)
  list[#list + 1] = { code = code, entity = e.id, position = { x = e.x, y = e.y }, message = message }
end

--- Build the edge list. Returns edges (sorted {from, to}), problems.
local function build_edges(model, grid)
  local edges, problems = {}, {}
  local function edge(a, b)
    edges[#edges + 1] = { from = a, to = b }
  end
  for _, e in ipairs(model.entities) do
    local v = direction.vector(e.dir)
    if CARRIERS[e.kind] and e.kind == "underground" and e.io == "input" then
      -- the matching exit, as the game pairs them: the first underground of the same name ahead on
      -- this line (either way it faces); it must be an exit facing the same way. Another entrance of
      -- the same name in between takes the exit (#23: two pairs interleaved on one line), and this
      -- entrance then leads nowhere.
      local paired, first = nil, nil
      for k = 1, e.proto.max_distance do
        local o = at(grid, e.x + v.x * k, e.y + v.y * k)
        if o and o.kind == "underground" and o.name == e.name and (o.dir == e.dir or o.dir == (e.dir + 8) % 16) then
          first = o
          break
        end
      end
      if first and first.dir == e.dir and first.io == "output" then
        paired = first
      end
      if paired then
        edge(e, paired)
      elseif first then
        problem(
          problems,
          "underground-unpaired",
          e,
          string.format(
            "%s at %g, %g meets another %s (at %g, %g) before its exit: they pair up wrongly",
            e.name,
            e.x,
            e.y,
            e.name,
            first.x,
            first.y
          )
        )
      else
        problem(
          problems,
          "underground-unpaired",
          e,
          e.name .. " has no exit within " .. e.proto.max_distance .. " tiles"
        )
      end
    elseif CARRIERS[e.kind] or e.kind == "input_port" or e.kind == "splitter" then
      -- a splitter pushes items out of both its tiles; everything else out of its one tile
      local fronts = e.kind == "splitter" and e.tiles or { { math.floor(e.x), math.floor(e.y) } }
      local seen = {}
      for _, tile in ipairs(fronts) do
        local t = at(grid, tile[1] + v.x + 0.5, tile[2] + v.y + 0.5)
        -- a belt does not feed a belt coming head-on (ports are belts too); a splitter only takes
        -- items from behind
        if t and not seen[t] and t.dir ~= direction.opposite(e.dir) then
          if t.kind == "belt" or t.kind == "output_port" then
            seen[t] = true
            edge(e, t)
          elseif t.kind == "underground" and t.io == "input" then
            seen[t] = true
            edge(e, t)
          elseif t.kind == "splitter" and t.dir == e.dir then
            seen[t] = true
            edge(e, t)
          end
        end
      end
    elseif e.kind == "drill" then
      -- a mining drill puts what it mines on the tile in front of it (its drop position)
      local d = direction.rotate({ x = e.proto.drop[1], y = e.proto.drop[2] }, e.dir)
      local dst = at(grid, e.x + d.x, e.y + d.y)
      if not dst or not (CARRIERS[dst.kind] or dst.kind == "output_port") then
        problem(problems, "drill-no-drop", e, e.name .. " has no belt in front of it")
      else
        edge(e, dst)
      end
    elseif e.kind == "inserter" then
      local p = e.pickup_position or direction.rotate({ x = e.proto.pickup_position[1], y = e.proto.pickup_position[2] }, e.dir)
      local d = e.drop_position or direction.rotate({ x = e.proto.insert_position[1], y = e.proto.insert_position[2] }, e.dir)
      local src = at(grid, e.x + p.x, e.y + p.y)
      local dst = at(grid, e.x + d.x, e.y + d.y)
      if not src or src.kind == "inserter" or src.kind == "output_port" then
        problem(problems, "inserter-no-pickup", e, "inserter has nothing to pick up from")
      else
        edge(src, e)
      end
      if not dst or dst.kind == "inserter" or dst.kind == "input_port" then
        problem(problems, "inserter-no-drop", e, "inserter has nothing to drop into")
      else
        edge(e, dst)
      end
    end
  end
  table.sort(edges, function(a, b)
    if a.from.id ~= b.from.id then
      return a.from.id < b.from.id
    end
    return a.to.id < b.to.id
  end)
  return edges, problems
end

--- What a mining drill mines: the results of every ore within its mining radius (resources:
--- {["x,y"] = resource name}).
local function mined_by(e, pack, resources)
  local out = {}
  local r = e.proto.radius
  for x = math.floor(e.x - r), math.floor(e.x + r) do
    for y = math.floor(e.y - r), math.floor(e.y + r) do
      local name = resources[x .. "," .. y]
      local res = name and pack.resources and pack.resources[name]
      if res and math.abs(x + 0.5 - e.x) <= r and math.abs(y + 0.5 - e.y) <= r then
        for _, p in ipairs(res.results) do
          out[p.name] = true
        end
      end
    end
  end
  return out
end

--- Run the flow check. Returns problems, warnings, state ({items = id -> set, inputs = id -> set}).
--- resources: optional ore per tile, for mining drills.
function flow.check(model, pack, grid, resources)
  local problems, warnings = {}, {}
  local edges, edge_problems = build_edges(model, grid)
  for _, p in ipairs(edge_problems) do
    problems[#problems + 1] = p
  end

  -- recipes per machine
  local recipe_of = {}
  for _, e in ipairs(model.entities) do
    if e.kind == "machine" then
      local r = e.recipe and pack.recipes[e.recipe]
      if not e.recipe then
        problem(problems, "machine-no-recipe", e, e.name .. " has no recipe")
      elseif not r then
        problem(problems, "unknown-recipe", e, "unknown recipe " .. e.recipe)
      else
        local allowed = false
        for _, c in ipairs(e.proto.categories) do
          allowed = allowed or c == r.category
        end
        if allowed then
          recipe_of[e.id] = r
        else
          problem(problems, "recipe-not-allowed", e, e.name .. " cannot craft " .. e.recipe)
        end
      end
    end
  end

  local items, inputs = {}, {} -- items an entity holds or carries; ingredients a machine received
  for _, e in ipairs(model.entities) do
    items[e.id] = {}
    inputs[e.id] = {}
    if e.kind == "input_port" and e.item then
      items[e.id][e.item] = true
    elseif e.kind == "drill" then
      items[e.id] = mined_by(e, pack, resources or {})
    end
  end

  -- furnaces (M10) pick their recipe from what they get: any recipe of their categories whose
  -- ingredients all arrived; burner furnaces also need a fuel they burn
  local function burns(e, item)
    local f = (pack.fuels or {})[item]
    for _, c in ipairs(f and e.proto.fuel_categories or {}) do
      if c == f.category then
        return true
      end
    end
    return false
  end
  local smelting = {} -- furnace name -> sorted recipe names it can make
  local function recipes_of_furnace(e)
    if not smelting[e.name] then
      local list = {}
      for name, r in pairs(pack.recipes) do
        for _, c in ipairs(e.proto.categories) do
          if c == r.category then
            list[#list + 1] = name
          end
        end
      end
      table.sort(list)
      smelting[e.name] = list
    end
    return smelting[e.name]
  end
  local function takes(e, item)
    if e.kind == "furnace" then
      if burns(e, item) then
        return true
      end
      for _, name in ipairs(recipes_of_furnace(e)) do
        for _, ing in ipairs(pack.recipes[name].ingredients) do
          if ing.name == item then
            return true
          end
        end
      end
      return false
    end
    local r = recipe_of[e.id]
    for _, ing in ipairs(r and r.ingredients or {}) do
      if ing.name == item then
        return true
      end
    end
    return false
  end
  local function fueled(e)
    if not e.proto.fuel_categories then
      return true
    end
    for item in pairs(inputs[e.id]) do
      if burns(e, item) then
        return true
      end
    end
    return false
  end
  -- the recipe a furnace works on: the first whose ingredients all arrived
  local function furnace_recipe(e)
    for _, name in ipairs(recipes_of_furnace(e)) do
      local r = pack.recipes[name]
      local all = #r.ingredients > 0
      for _, ing in ipairs(r.ingredients) do
        all = all and ing.type == "item" and inputs[e.id][ing.name] or false
      end
      if all then
        return r
      end
    end
    return nil
  end

  local function machine_running(e)
    if e.kind == "furnace" then
      return furnace_recipe(e) ~= nil and fueled(e)
    end
    local r = recipe_of[e.id]
    if not r then
      return false
    end
    for _, ing in ipairs(r.ingredients) do
      if not inputs[e.id][ing.name] then
        return false
      end
    end
    return true
  end

  local function offered(src)
    if src.kind == "machine" or src.kind == "furnace" then
      local out = {}
      if machine_running(src) then
        local r = src.kind == "furnace" and furnace_recipe(src) or recipe_of[src.id]
        for _, res in ipairs(r.results) do
          out[res.name] = true
        end
      end
      return out
    end
    return items[src.id]
  end

  local changed = true
  while changed do
    changed = false
    for _, ed in ipairs(edges) do
      local src, dst = ed.from, ed.to
      for item in pairs(offered(src)) do
        if dst.kind == "machine" or dst.kind == "furnace" then
          -- an inserter only moves items the machine accepts
          if takes(dst, item) and not inputs[dst.id][item] then
            inputs[dst.id][item] = true
            changed = true
          end
        elseif not items[dst.id][item] then
          -- an inserter in front of a machine only picks up what that machine takes
          local accept = true
          if dst.kind == "inserter" then
            for _, ed2 in ipairs(edges) do
              if ed2.from == dst and (ed2.to.kind == "machine" or ed2.to.kind == "furnace") then
                accept = takes(ed2.to, item)
              end
            end
          end
          if accept then
            items[dst.id][item] = true
            changed = true
          end
        end
      end
    end
  end

  for _, e in ipairs(model.entities) do
    local r = recipe_of[e.id]
    if e.kind == "furnace" then
      if not furnace_recipe(e) then
        problem(problems, "missing-ingredient", e, e.name .. " gets nothing it can smelt")
      elseif not fueled(e) then
        problem(problems, "missing-fuel", e, e.name .. " gets no fuel")
      end
    elseif r then
      local missing = {}
      for _, ing in ipairs(r.ingredients) do
        if not inputs[e.id][ing.name] then
          missing[#missing + 1] = ing.name
        end
      end
      table.sort(missing)
      if #missing > 0 then
        problem(
          problems,
          "missing-ingredient",
          e,
          e.name .. " (" .. e.recipe .. ") gets no " .. table.concat(missing, ", ")
        )
      end
    elseif e.kind == "output_port" and e.item then
      local got = sorted_keys(items[e.id])
      if #got == 0 then
        problem(problems, "output-not-reached", e, "nothing reaches output port for " .. e.item)
      else
        if not items[e.id][e.item] then
          problem(problems, "output-wrong-item", e, "output port for " .. e.item .. " does not receive it")
        end
        local foreign = {}
        for _, item in ipairs(got) do
          if item ~= e.item then
            foreign[#foreign + 1] = item
          end
        end
        if #foreign > 0 then
          problem(
            problems,
            "output-foreign-item",
            e,
            "output port for " .. e.item .. " also receives " .. table.concat(foreign, ", ")
          )
        end
      end
    elseif CARRIERS[e.kind] then
      local got = sorted_keys(items[e.id])
      if #got > 2 then
        problem(warnings, "belt-mixed", e, "belt carries more than two items: " .. table.concat(got, ", "))
      end
    end
  end

  -- backward trace: machines that feed no output port are unused
  local feeds = {}
  for _, ed in ipairs(edges) do
    feeds[ed.to.id] = feeds[ed.to.id] or {}
    table.insert(feeds[ed.to.id], ed.from)
  end
  local used, stack = {}, {}
  for _, e in ipairs(model.entities) do
    if e.kind == "output_port" then
      stack[#stack + 1] = e
    end
  end
  while #stack > 0 do
    local e = table.remove(stack)
    if not used[e.id] then
      used[e.id] = true
      for _, src in ipairs(feeds[e.id] or {}) do
        stack[#stack + 1] = src
      end
    end
  end
  for _, e in ipairs(model.entities) do
    if (e.kind == "machine" or e.kind == "furnace") and not used[e.id] then
      problem(warnings, "machine-unused", e, e.name .. " does not feed any output port")
    end
  end

  return problems, warnings, { items = items, inputs = inputs, edges = edges }
end

return flow
