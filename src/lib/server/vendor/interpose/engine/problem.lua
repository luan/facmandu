--- Problem file (F1): what to build, from which input ports, where, with which entity tiers.
---
--- {
---   "output": {"item": "electronic-circuit", "rate": "1/2", "position": {"x": 9.5, "y": 0.5}, "direction": 4},
---   "inputs": [{"item": "iron-plate", "position": {"x": 0.5, "y": 0.5}, "direction": 4}, ...],
---   "area": [[0, 0], [20, 12]],
---   "tiers": {"machine": "assembling-machine-2", "belt": "transport-belt",
---             "underground": "underground-belt", "inserter": "inserter"}
--- }
--- rate: items per second, as a number or an exact "n/d" string, or "max" for the most the belts
--- carry. area: tiles x1 <= x < x2, y1 <= y < y2.
--- obstacles (optional, M9d): tiles nothing may be built on, e.g. cliffs, power poles, water:
--- [{"x": 5, "y": 7}, ...] (a tile's top-left corner, whole numbers). Underground belts may pass under.
--- A port's direction is where its items go (input) or where it faces (output); an input port must
--- face a tile inside the area.
local fraction = require("engine.model.fraction")
local direction = require("engine.model.direction")
local issues = require("engine.issues")
local balancer = require("engine.placement.balancer")

local problem = {}

local TIERS = { machine = "machines", belt = "belts", underground = "undergrounds", inserter = "inserters" }

local function is_number(v)
  return type(v) == "number" and v == v and v ~= math.huge and v ~= -math.huge
end

local function on_grid_1x1(pos)
  return type(pos) == "table"
    and is_number(pos.x)
    and is_number(pos.y)
    and pos.x - math.floor(pos.x) == 0.5
    and pos.y - math.floor(pos.y) == 0.5
end

--- Every item name the pack knows (from recipe ingredients and results).
function problem.known_items(pack)
  local known = {}
  for _, r in pairs(pack.recipes) do
    for _, list in ipairs({ r.ingredients, r.results }) do
      for _, p in ipairs(list) do
        if p.type == "item" then
          known[p.name] = true
        end
      end
    end
  end
  return known
end

--- Load and check a problem table. Returns problem (normalised) or nil, and a list of issues
--- (engine/issues.lua). All problems are reported at once.
function problem.load(p, pack)
  local errors = {}
  local function err(code, hint, fmt, ...)
    errors[#errors + 1] = issues.new(code, string.format(fmt, ...), hint)
  end
  if type(p) ~= "table" or #p > 0 or p.blueprint or p.blueprint_book then
    err(
      "not-a-problem",
      "a problem file has output, inputs, area and tiers; blueprints go to `validate`",
      "this is not a problem file"
    )
    return nil, errors
  end
  local out = { inputs = {}, tiers = {} }
  local known = problem.known_items(pack)

  local area = p.area
  local area_ok = type(area) == "table"
    and type(area[1]) == "table"
    and type(area[2]) == "table"
    and is_number(area[1][1])
    and is_number(area[1][2])
    and is_number(area[2][1])
    and is_number(area[2][2])
  if not area_ok or area[1][1] >= area[2][1] or area[1][2] >= area[2][2] then
    err("bad-area", "for example [[0, 0], [20, 20]]", "area must be [[x1, y1], [x2, y2]] with x1 < x2 and y1 < y2")
    area = nil
  end
  out.area = area

  -- resources (kind "mine"): the ore under the area, [{"name": "iron-ore", "x": 5, "y": 7}, ...]
  out.resources = {}
  if p.resources ~= nil then
    local ok = type(p.resources) == "table"
    for _, t in ipairs(ok and p.resources or {}) do
      if
        type(t) ~= "table"
        or not is_number(t.x)
        or not is_number(t.y)
        or t.x % 1 ~= 0
        or t.y % 1 ~= 0
        or not (pack.resources or {})[t.name]
      then
        ok = false
      else
        out.resources[#out.resources + 1] = { name = t.name, x = t.x, y = t.y }
      end
    end
    if not ok then
      err(
        "bad-resources",
        'for example [{"name": "iron-ore", "x": 5, "y": 7}]',
        "resources must be a list of tiles with whole-number x and y and an ore the game pack knows"
      )
    end
    table.sort(out.resources, function(a, b)
      if a.y ~= b.y then
        return a.y < b.y
      end
      return a.x < b.x
    end)
  end

  -- obstacles: a list of whole-number tiles, kept in a fixed order without repeats
  out.obstacles = {}
  if p.obstacles ~= nil then
    local ok = type(p.obstacles) == "table"
    local seen = {}
    for _, t in ipairs(ok and p.obstacles or {}) do
      if type(t) ~= "table" or not is_number(t.x) or not is_number(t.y) or t.x % 1 ~= 0 or t.y % 1 ~= 0 then
        ok = false
      elseif not seen[t.x .. "," .. t.y] then
        seen[t.x .. "," .. t.y] = true
        out.obstacles[#out.obstacles + 1] = { x = t.x, y = t.y }
      end
    end
    if not ok then
      err(
        "bad-obstacles",
        'for example [{"x": 5, "y": 7}]',
        "obstacles must be a list of tiles with whole-number x and y"
      )
    end
    table.sort(out.obstacles, function(a, b)
      if a.y ~= b.y then
        return a.y < b.y
      end
      return a.x < b.x
    end)
  end

  local function inside(x, y)
    return area and x >= area[1][1] and y >= area[1][2] and x < area[2][1] and y < area[2][2]
  end

  local function port(def, label, kind)
    if type(def) ~= "table" then
      return nil
    end
    if type(def.item) ~= "string" then
      err("port-without-item", "pick the item for this port", "%s has no item", label)
      return nil
    end
    if not known[def.item] then
      err(
        "unknown-item",
        "check the spelling; items from mods need a game pack with those mods",
        "%s: unknown item %s",
        label,
        def.item
      )
    end
    if not on_grid_1x1(def.position) then
      err(
        "bad-position",
        "use a tile centre like {x = 0.5, y = 0.5}",
        "%s (%s) is not on a tile centre",
        label,
        def.item
      )
      return nil
    end
    local dir = def.direction or direction.NORTH
    if not direction.is_cardinal(dir) then
      err(
        "bad-direction",
        "use 0 (north), 4 (east), 8 (south) or 12 (west)",
        "%s (%s) has direction %s",
        label,
        def.item,
        tostring(dir)
      )
      return nil
    end
    local x, y = def.position.x, def.position.y
    if area and not inside(x, y) then
      err(
        "port-outside-area",
        "move the port into the area, or make the area larger",
        "%s (%s) lies outside the area",
        label,
        def.item
      )
    end
    local v = direction.vector(dir)
    if kind == "input" and area and inside(x, y) and not inside(x + v.x, y + v.y) then
      err("port-faces-out", "turn the port so it faces into the area", "%s (%s) faces out of the area", label, def.item)
    end
    return { item = def.item, position = { x = x, y = y }, direction = dir }
  end

  -- kind: "craft" (default: make one output from the inputs) or "transport" (move input items to
  -- output ports unchanged; several outputs allowed)
  -- "mine" (M9f): an output port for an ore, and the ore field under the area (resources)
  local kind = p.kind == nil and "craft" or p.kind
  if kind ~= "craft" and kind ~= "transport" and kind ~= "mine" then
    err("bad-kind", 'use "craft" (the default), "transport" or "mine"', "kind %s is not known", tostring(p.kind))
    kind = "craft"
  end
  out.kind = kind
  local defs = p.outputs or (p.output ~= nil and { p.output }) or nil
  if p.outputs ~= nil and p.output ~= nil then
    err("bad-output", "use either output or outputs", "the problem has both output and outputs")
  end
  out.outputs = {}
  if defs == nil then
    err("missing-output", "mark the product with an output port", "the problem has no output")
  elseif type(defs) ~= "table" or (p.output ~= nil and type(p.output) ~= "table") then
    err("bad-output", "output must be an object with item, rate and position", "output is not an object")
  else
    for i, def in ipairs(defs) do
      local label = #defs > 1 and ("output " .. i) or "output"
      local o = port(def, label, "output")
      if o then
        -- a rate is required to craft; for transport it is optional (everything that arrives).
        -- "max": the most the belt tier allows (engine/solve.lua works it out)
        if def.rate == "max" then
          o.rate_max = true
        elseif def.rate ~= nil or kind ~= "transport" then
          local ok, rate = pcall(fraction.from, def.rate)
          if not ok or not fraction.is(rate) or rate <= fraction.new(0) then
            err(
              "bad-rate",
              'a positive number of items per second, e.g. 1.5 or "3/2"',
              "%s rate %s is not a positive number",
              label,
              tostring(def.rate)
            )
          else
            o.rate = rate
          end
        end
        out.outputs[#out.outputs + 1] = o
      end
    end
    -- several products (M10): each needs its own rate; "max" is for one product
    if kind ~= "transport" and #defs > 1 then
      local maxed = false
      for _, o in ipairs(out.outputs) do
        maxed = maxed or o.rate_max or false
      end
      if kind == "mine" or maxed then
        err(
          "several-outputs",
          kind == "mine" and "mine one ore per layout" or "set a target rate on every output port",
          kind == "mine" and "the problem asks to mine %d outputs"
            or "the problem asks for %d products, and not every one has a rate",
          #defs
        )
      end
    end
  end
  out.output = out.outputs[1]

  if p.inputs ~= nil and type(p.inputs) ~= "table" then
    err("bad-inputs", "inputs must be a list of ports", "inputs is not a list")
  end
  local seen = {}
  for i, def in ipairs(type(p.inputs) == "table" and p.inputs or {}) do
    local inp = port(def, "input " .. i, "input")
    if inp then
      -- transport may bring one item in on several belts (they are balanced); crafting takes one
      if seen[inp.item] and kind ~= "transport" then
        err("duplicate-input", "one input port per item", "input item %s is declared twice", inp.item)
      end
      seen[inp.item] = true
      out.inputs[#out.inputs + 1] = inp
    end
  end
  -- auto_inputs (M9e): no input ports; the engine places them (engine/auto.lua)
  out.auto_inputs = p.auto_inputs == true or nil
  if #out.inputs == 0 and not out.auto_inputs and kind ~= "mine" then
    err("missing-inputs", "mark at least one ingredient with an input port", "the problem has no input ports")
  end

  -- ports must not share a tile, and an input must not point straight into another port
  local ports = {}
  for _, inp in ipairs(out.inputs) do
    ports[#ports + 1] = { def = inp, label = "input " .. inp.item }
  end
  for _, o in ipairs(out.outputs) do
    ports[#ports + 1] = { def = o, label = "output " .. o.item }
  end
  local at = {}
  for _, pt in ipairs(ports) do
    local k = math.floor(pt.def.position.x) .. "," .. math.floor(pt.def.position.y)
    if at[k] then
      err("ports-overlap", "give every port its own tile", "%s and %s are on the same tile", at[k].label, pt.label)
    end
    at[k] = pt
  end
  for _, inp in ipairs(out.inputs) do
    local v = direction.vector(inp.direction)
    local k = math.floor(inp.position.x + v.x) .. "," .. math.floor(inp.position.y + v.y)
    if at[k] then
      err(
        "port-faces-port",
        "leave the tile in front of an input port free",
        "input %s points straight into %s",
        inp.item,
        at[k].label
      )
    end
  end

  -- an output port needs at least one free neighbour tile for a belt to come in
  for _, o in ipairs(area and out.outputs or {}) do
    local ox, oy = math.floor(o.position.x), math.floor(o.position.y)
    local free = false
    for _, d in ipairs({ 0, 4, 8, 12 }) do
      local v = direction.vector(d)
      local nx, ny = ox + v.x, oy + v.y
      if inside(nx + 0.5, ny + 0.5) and not at[nx .. "," .. ny] then
        free = true
      end
    end
    if not free and inside(o.position.x, o.position.y) then
      err(
        "output-boxed-in",
        "leave a free tile next to the output port",
        "no belt can reach the output port for %s: every side is blocked",
        o.item
      )
    end
  end

  -- transport: every output item must come from an input; several belts of one item are balanced
  if kind == "transport" then
    local ins, outs = {}, {}
    for _, inp in ipairs(out.inputs) do
      ins[inp.item] = (ins[inp.item] or 0) + 1
    end
    for _, o in ipairs(out.outputs) do
      outs[o.item] = (outs[o.item] or 0) + 1
    end
    for _, o in ipairs(out.outputs) do
      if not ins[o.item] then
        err("not-an-input", "transport only moves input items; add an input port for it", "nothing supplies %s", o.item)
        ins[o.item] = 0
      end
    end
    for item, n in pairs(ins) do
      local m = outs[item] or 0
      if n > 0 and m > 0 and not (n == 1 and m == 1) and not balancer.block(n, m) then
        err(
          "unsupported-balancer",
          "balancers exist for 1-2, 1-4, 2-1, 2-2, 2-4, 4-1 and 4-2 belts; change the number of ports",
          "%s comes in on %d belts and goes out on %d: no balancer for that yet",
          item,
          n,
          m
        )
      end
    end
  end

  if type(p.tiers) ~= "table" then
    err(
      "missing-tiers",
      "add tiers with a machine, belt, underground and inserter, e.g. assembling-machine-2, transport-belt",
      "the problem does not say which machine, belt, underground and inserter to use"
    )
  else
    for _, key in ipairs({ "belt", "inserter", "machine", "underground" }) do
      local name = p.tiers[key]
      -- a mining layout has no machines or inserters
      local optional = kind == "mine" and (key == "machine" or key == "inserter") and name == nil
      if not optional and (type(name) ~= "string" or not (pack[TIERS[key]] or {})[name]) then
        local article = key:match("^[aeiou]") and "an" or "a"
        err(
          "unknown-tier",
          string.format("tiers.%s must name %s %s the game pack knows", key, article, key),
          "tiers.%s is %s",
          key,
          tostring(name)
        )
      elseif not optional then
        out.tiers[key] = name
      end
    end
    -- the splitter tier is optional: it follows the belt tier unless given
    local sp = p.tiers.splitter
    if sp ~= nil and (type(sp) ~= "string" or not (pack.splitters or {})[sp]) then
      err(
        "unknown-tier",
        "tiers.splitter must name a splitter the game pack knows",
        "tiers.splitter is %s",
        tostring(sp)
      )
    elseif sp then
      out.tiers.splitter = sp
    elseif out.tiers.belt then
      out.tiers.splitter = balancer.splitter_for(out.tiers.belt, pack)
    end
    -- the furnace (M10): optional, stone by default; smelting rows use it
    local fu = p.tiers.furnace
    if fu ~= nil and (type(fu) ~= "string" or not (pack.furnaces or {})[fu]) then
      err("unknown-tier", "tiers.furnace must name a furnace the game pack knows", "tiers.furnace is %s", tostring(fu))
    elseif fu then
      out.tiers.furnace = fu
    elseif (pack.furnaces or {})["stone-furnace"] then
      out.tiers.furnace = "stone-furnace"
    end
    -- M11: the power pole types for a layout's poles (optional): engine/power.lua after routing
    local pl = p.tiers.poles
    if pl ~= nil then
      local ok = type(pl) == "table"
      for _, name in ipairs(ok and pl or {}) do
        ok = ok and type(name) == "string" and (pack.poles or {})[name] ~= nil
      end
      if not ok then
        err("unknown-tier", "tiers.poles must list power poles the game pack knows", "tiers.poles is %s", tostring(pl))
      else
        out.tiers.poles = pl
      end
    end
    -- M11: a 1x1 power pole the rows leave room for when the first layout leaves machines unpowered
    local po = p.tiers.pole
    local pole_proto = po ~= nil and type(po) == "string" and (pack.poles or {})[po]
    if po ~= nil and not (pole_proto and pole_proto.size[1] == 1) then
      err("unknown-tier", "tiers.pole must name a 1x1 power pole the game pack knows", "tiers.pole is %s", tostring(po))
    elseif po then
      out.tiers.pole = po
    end
    -- the mining drill: optional, electric by default
    local dr = p.tiers.drill
    if dr ~= nil and (type(dr) ~= "string" or not (pack.drills or {})[dr]) then
      err("unknown-tier", "tiers.drill must name a mining drill the game pack knows", "tiers.drill is %s", tostring(dr))
    elseif dr then
      out.tiers.drill = dr
    elseif (pack.drills or {})["electric-mining-drill"] then
      out.tiers.drill = "electric-mining-drill"
    end
    -- the long-handed inserter is optional too: rows with a second input belt use it
    local li = p.tiers.long_inserter
    if li ~= nil and (type(li) ~= "string" or not pack.inserters[li]) then
      err(
        "unknown-tier",
        "tiers.long_inserter must name an inserter the game pack knows",
        "tiers.long_inserter is %s",
        tostring(li)
      )
    elseif li then
      out.tiers.long_inserter = li
    elseif pack.inserters["long-handed-inserter"] then
      out.tiers.long_inserter = "long-handed-inserter"
    end
  end

  if #errors > 0 then
    return nil, errors
  end
  return out, errors
end

return problem
