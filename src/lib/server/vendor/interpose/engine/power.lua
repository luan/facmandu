--- M11: electric poles for a layout. Pure: entities and tiles in, poles and wires out.
---
--- cover: poles so every electric entity of a layout is supplied, all wired into one network. Greedy:
--- the next pole is the one (of the allowed types, on a free tile in the area) that supplies the most
--- entities still without power, and it must be wired to a pole placed before it; when no such pole
--- adds anything, a "bridge" pole steps towards the nearest entity still without power.
---
--- connect: a chain of poles between existing poles, so they form one network: a shortest chain
--- (fewest poles, A*) over free tiles, each hop within both poles' wire reach.
---
--- Poles come from pack.poles: {size = {w, h}, supply = supply area distance, reach = wire reach}.
--- A pole's position is its centre, as in a blueprint.
local blueprint = require("engine.blueprint")
local heap = require("engine.model.heap")
local issues = require("engine.issues")

local power = {}

local function key(x, y)
  return x .. "," .. y
end

--- Does this entity need electricity? Machines, electric furnaces, electric drills and inserters.
function power.needs(name, pack)
  local m = pack.machines and pack.machines[name]
  if m then
    return not m.burner
  end
  local f = pack.furnaces and pack.furnaces[name]
  if f then
    return f.fuel_categories == nil
  end
  local d = pack.drills and pack.drills[name]
  if d then
    return not d.burner
  end
  local i = pack.inserters and pack.inserters[name]
  if i then
    return not i.burner
  end
  return false
end

-- the pole types allowed, biggest supply area first (the greedy tries them in this order)
local function types_of(names, pack)
  local list = {}
  for _, name in ipairs(names) do
    local p = pack.poles and pack.poles[name]
    if p then
      list[#list + 1] = { name = name, size = p.size[1], supply = p.supply, reach = p.reach }
    end
  end
  table.sort(list, function(a, b)
    if a.supply ~= b.supply then
      return a.supply > b.supply
    end
    return a.name < b.name
  end)
  return list
end

-- occupied tiles, the boxes of the entities that need power, and the poles the layout already has
-- (M11: rows leave room for them), from blueprint entities
local function survey(entities, pack)
  local model = blueprint.load({ entities = entities }, pack)
  local taken, needs, fixed = {}, {}, {}
  for _, e in ipairs(model.entities) do
    if e.kind == "pole" then
      fixed[#fixed + 1] = { name = e.name, x = e.tx, y = e.ty }
    end
    local x0, y0, x1, y1 = math.huge, math.huge, -math.huge, -math.huge
    for _, t in ipairs(e.tiles) do
      taken[key(t[1], t[2])] = true
      x0, y0 = math.min(x0, t[1]), math.min(y0, t[2])
      x1, y1 = math.max(x1, t[1] + 1), math.max(y1, t[2] + 1)
    end
    if power.needs(e.name, pack) then
      -- the game supplies an entity when a pole's area overlaps its collision box, which is smaller
      -- than its tiles (an inserter's: 0.3 of a tile): count only overlap that reaches that far in
      local inset = 0.35
      needs[#needs + 1] = { x0 = x0 + inset, y0 = y0 + inset, x1 = x1 - inset, y1 = y1 - inset }
    end
  end
  table.sort(fixed, function(a, b)
    if a.y ~= b.y then
      return a.y < b.y
    end
    return a.x < b.x
  end)
  return taken, needs, fixed
end

-- a pole of type t with its top-left tile at (x, y): its centre
local function centre(t, x, y)
  return { x = x + t.size / 2, y = y + t.size / 2 }
end

local function supplies(t, c, box)
  return box.x0 < c.x + t.supply and box.x1 > c.x - t.supply and box.y0 < c.y + t.supply and box.y1 > c.y - t.supply
end

local function wired(a_reach, a, b_reach, b)
  local r = math.min(a_reach, b_reach)
  return (a.x - b.x) ^ 2 + (a.y - b.y) ^ 2 <= r * r + 1e-9
end

--- Poles for a layout. opts: {area = {{x0, y0}, {x1, y1}}, blocked = set of "x,y" (obstacles, ports'
--- fronts...), poles = names of the allowed types}. Poles already in the layout count as placed.
--- Returns { poles = the new poles (blueprint entities: name, position), wires = {{a, b}} where a and b
--- are pole positions (the layout's poles and the new ones), unpowered = entities no pole reaches,
--- missed = their boxes }.
function power.cover(entities, pack, opts)
  local types = types_of(opts.poles or {}, pack)
  local taken, needs, fixed = survey(entities, pack)
  for k in pairs(opts.blocked or {}) do
    taken[k] = true
  end
  local a = opts.area
  local function free(t, x, y)
    for dx = 0, t.size - 1 do
      for dy = 0, t.size - 1 do
        local tx, ty = x + dx, y + dy
        if tx < a[1][1] or ty < a[1][2] or tx >= a[2][1] or ty >= a[2][2] or taken[key(tx, ty)] then
          return false
        end
      end
    end
    return true
  end
  local poles, wires, placed = {}, {}, {}
  local powered = {}
  local function left()
    local l = {}
    for i in ipairs(needs) do
      if not powered[i] then
        l[#l + 1] = i
      end
    end
    return l
  end
  local function place(t, x, y, already)
    local c = centre(t, x, y)
    local nearest, best
    for i, p in ipairs(placed) do
      local d = (p.c.x - c.x) ^ 2 + (p.c.y - c.y) ^ 2
      if wired(t.reach, c, p.t.reach, p.c) and (not best or d < best) then
        nearest, best = i, d
      end
    end
    placed[#placed + 1] = { t = t, c = c }
    if not already then
      poles[#poles + 1] = { name = t.name, position = { x = c.x, y = c.y } }
    end
    if nearest then
      local n = placed[nearest].c
      wires[#wires + 1] = { { x = n.x, y = n.y }, { x = c.x, y = c.y } }
    end
    for dx = 0, t.size - 1 do
      for dy = 0, t.size - 1 do
        taken[key(x + dx, y + dy)] = true
      end
    end
    for i, box in ipairs(needs) do
      if supplies(t, c, box) then
        powered[i] = true
      end
    end
  end
  local function linked(t, c)
    if #placed == 0 then
      return true
    end
    for _, p in ipairs(placed) do
      if wired(t.reach, c, p.t.reach, p.c) then
        return true
      end
    end
    return false
  end
  -- the layout's own poles first (types not allowed now are still poles: take them as they are)
  for _, f in ipairs(fixed) do
    local p = pack.poles[f.name]
    place({ name = f.name, size = p.size[1], supply = p.supply, reach = p.reach }, f.x, f.y, true)
  end
  -- every candidate in a fixed order (types by supply, then y, then x): deterministic
  local guard = 0
  while #types > 0 do
    guard = guard + 1
    local todo = left()
    if #todo == 0 or guard > 10000 then
      break
    end
    local best, best_n
    for _, t in ipairs(types) do
      for y = a[1][2], a[2][2] - t.size do
        for x = a[1][1], a[2][1] - t.size do
          if free(t, x, y) then
            local c = centre(t, x, y)
            if linked(t, c) then
              local n = 0
              for _, i in ipairs(todo) do
                if supplies(t, c, needs[i]) then
                  n = n + 1
                end
              end
              if n > 0 and (not best_n or n > best_n) then
                best, best_n = { t = t, x = x, y = y }, n
              end
            end
          end
        end
      end
    end
    if not best then
      -- a bridge: the linked pole (longest reach first) that gets closest to an entity without power
      local target = needs[todo[1]]
      local tx, ty = (target.x0 + target.x1) / 2, (target.y0 + target.y1) / 2
      local here = math.huge
      for _, p in ipairs(placed) do
        here = math.min(here, (p.c.x - tx) ^ 2 + (p.c.y - ty) ^ 2)
      end
      local best_d
      for _, t in ipairs(types) do
        for y = a[1][2], a[2][2] - t.size do
          for x = a[1][1], a[2][1] - t.size do
            if free(t, x, y) then
              local c = centre(t, x, y)
              local d = (c.x - tx) ^ 2 + (c.y - ty) ^ 2
              if d < here and (not best_d or d < best_d) and linked(t, c) then
                best, best_d = { t = t, x = x, y = y }, d
              end
            end
          end
        end
      end
      if not best then
        break -- nothing gets closer: those entities stay without power
      end
    end
    place(best.t, best.x, best.y)
  end
  local unpowered, missed = 0, {}
  for i, box in ipairs(needs) do
    if not powered[i] then
      unpowered = unpowered + 1
      missed[#missed + 1] = box
    end
  end
  -- one network: poles that cover well may still stand too far apart to wire (the rows' own poles,
  -- one set per row); join the groups with a chain of poles, as for joining poles
  local split = false
  if #placed > 1 and #types > 0 then
    local all = {}
    for _, p in ipairs(placed) do
      all[#all + 1] = { name = p.t.name, position = { x = p.c.x, y = p.c.y } }
    end
    local names = {}
    for _, t in ipairs(types) do
      names[#names + 1] = t.name
    end
    local joined = power.connect_with(all, pack, { area = a, blocked = taken, poles = names })
    if joined then
      local function pos_of(ref)
        local p = ref.existing and all[ref.existing] or joined.poles[ref.new]
        return { x = p.position.x, y = p.position.y }
      end
      wires = {}
      for _, w in ipairs(joined.wires) do
        wires[#wires + 1] = { pos_of(w[1]), pos_of(w[2]) }
      end
      for _, p in ipairs(joined.poles) do
        poles[#poles + 1] = p
      end
    else
      split = true
    end
  end
  return { poles = poles, wires = wires, unpowered = unpowered, missed = missed, split = split or nil }
end

--- A chain of new poles joining existing poles into one network. existing: {{name, position}} (the
--- poles in the area; their types must be in pack.poles). opts: {area, blocked = set of "x,y" (what
--- stands there, the existing poles' tiles included), poles = names of the allowed types, prefer =
--- names tried alone first (the setting Auto: the types of the selected poles)}. Returns
--- { poles, wires = {{a, b}} where a and b are {existing = i} or {new = i} } or nil, issues.
function power.connect(existing, pack, opts)
  local prefer = {}
  local allowed = {}
  for _, name in ipairs(opts.poles or {}) do
    allowed[name] = true
  end
  for _, name in ipairs(opts.prefer or {}) do
    if allowed[name] then
      prefer[#prefer + 1] = name
    end
  end
  if #prefer > 0 and #prefer < #(opts.poles or {}) then
    local narrow = {}
    for k, v in pairs(opts) do
      narrow[k] = v
    end
    narrow.poles, narrow.prefer = prefer, nil
    local r = power.connect(existing, pack, narrow)
    if r then
      return r, {}
    end
  end
  return power.connect_with(existing, pack, opts)
end

-- connect with every allowed type
function power.connect_with(existing, pack, opts)
  local types = types_of(opts.poles or {}, pack)
  if #existing < 2 then
    return nil,
      { issues.new("no-poles", "the area needs at least two power poles to join", "select two or more poles") }
  end
  if #types == 0 then
    return nil,
      {
        issues.new(
          "no-pole-type",
          "no power pole type is allowed",
          "pick a power pole type (or Auto) in the mod settings"
        ),
      }
  end
  local a = opts.area
  local taken = {}
  for k in pairs(opts.blocked or {}) do
    taken[k] = true
  end
  local function free(t, x, y)
    for dx = 0, t.size - 1 do
      for dy = 0, t.size - 1 do
        local tx, ty = x + dx, y + dy
        if tx < a[1][1] or ty < a[1][2] or tx >= a[2][1] or ty >= a[2][2] or taken[key(tx, ty)] then
          return false
        end
      end
    end
    return true
  end
  local nodes = {} -- {c = centre, reach, existing = i or new = {t, x, y}}
  for i, p in ipairs(existing) do
    local proto = pack.poles[p.name]
    nodes[#nodes + 1] = { c = p.position, reach = proto.reach, existing = i }
  end
  local result_poles, wires = {}, {}
  local function ref(n)
    return n.existing and { existing = n.existing } or { new = n.new_index }
  end
  -- join the components one by one: from everything joined so far to the nearest pole not yet joined
  local joined = { [1] = true }
  local joined_nodes = { nodes[1] }
  -- existing poles already within reach of each other are one network
  local function absorb()
    local changed = true
    while changed do
      changed = false
      for i = 1, #existing do
        if not joined[i] then
          for _, n in ipairs(joined_nodes) do
            if wired(nodes[i].reach, nodes[i].c, n.reach, n.c) then
              joined[i] = true
              joined_nodes[#joined_nodes + 1] = nodes[i]
              wires[#wires + 1] = { ref(n), ref(nodes[i]) }
              changed = true
              break
            end
          end
        end
      end
    end
  end
  absorb()
  while true do
    local goal
    for i = 1, #existing do
      if not joined[i] then
        goal = nodes[i]
        break
      end
    end
    if not goal then
      break
    end
    -- A*: states are positions of new poles (top-left tile and type); cost = poles placed
    local max_reach = 0
    for _, t in ipairs(types) do
      max_reach = math.max(max_reach, t.reach)
    end
    local function dist(c)
      return math.sqrt((c.x - goal.c.x) ^ 2 + (c.y - goal.c.y) ^ 2)
    end
    local function h(c)
      return math.max(0, math.ceil(dist(c) / max_reach) - 1)
    end
    -- order: poles so far plus at least those still needed; among equals, the one nearest the goal
    -- (without it, the search tries every spot on a plateau of equal counts)
    local function priority(g, c)
      return (g + h(c)) * 100000 + dist(c)
    end
    local open = heap.new()
    local seen = {} -- per type index: numeric tile keys (strings for every candidate were the cost)
    local free_of = {}
    for ti in ipairs(types) do
      seen[ti], free_of[ti] = {}, {}
    end
    local W = 1048576 -- numeric key of a tile: (y + W/2) * W + (x + W/2)
    local parent = {}
    local count = 0
    for _, n in ipairs(joined_nodes) do
      count = count + 1
      local id = "start" .. count
      parent[id] = { node = n }
      if wired(n.reach, n.c, goal.reach, goal.c) then
        -- already joined (cannot happen after absorb, kept for safety)
        wires[#wires + 1] = { ref(n), ref(goal) }
      end
      heap.push(open, priority(0, n.c), { id = id, c = n.c, reach = n.reach, g = 0 })
    end
    local found
    local expanded = 0
    while not heap.empty(open) do
      local cur = heap.pop(open)
      ---@cast cur -nil
      if wired(cur.reach, cur.c, goal.reach, goal.c) and cur.g > 0 then
        found = cur
        break
      end
      expanded = expanded + 1
      if expanded > 4000 then
        break
      end
      for ti, t in ipairs(types) do
        local r = math.ceil(math.min(cur.reach, t.reach)) -- a hop reaches no further than both poles
        local s_t, f_t = seen[ti], free_of[ti]
        for y = math.floor(cur.c.y) - r, math.floor(cur.c.y) + r do
          for x = math.floor(cur.c.x) - r, math.floor(cur.c.x) + r do
            local k = (y + W / 2) * W + (x + W / 2)
            local ok = f_t[k]
            if ok == nil then
              ok = free(t, x, y)
              f_t[k] = ok
            end
            if ok and not s_t[k] then
              local c = centre(t, x, y)
              if wired(cur.reach, cur.c, t.reach, c) then
                s_t[k] = true
                local id = ti .. ":" .. k
                parent[id] = { from = cur.id, t = t, x = x, y = y }
                local g = cur.g + 1
                heap.push(open, priority(g, c), { id = id, c = c, reach = t.reach, g = g })
              end
            end
          end
        end
      end
    end
    if not found then
      return nil,
        {
          issues.new(
            "poles-unreachable",
            "the power poles cannot be joined inside the selected area",
            "select a larger area around the poles, or clear the way between them"
          ),
        }
    end
    -- walk back: place the chain, wire each hop
    local chain = {}
    local id = found.id
    while parent[id] and not parent[id].node do
      table.insert(chain, 1, parent[id])
      id = parent[id].from
    end
    local prev = parent[id].node
    for _, step in ipairs(chain) do
      local c = centre(step.t, step.x, step.y)
      result_poles[#result_poles + 1] = { name = step.t.name, position = { x = c.x, y = c.y } }
      local node = { c = c, reach = step.t.reach, new_index = #result_poles }
      wires[#wires + 1] = { ref(prev), ref(node) }
      for dx = 0, step.t.size - 1 do
        for dy = 0, step.t.size - 1 do
          taken[key(step.x + dx, step.y + dy)] = true
        end
      end
      joined_nodes[#joined_nodes + 1] = node
      prev = node
    end
    wires[#wires + 1] = { ref(prev), ref(goal) }
    for i = 1, #existing do
      if nodes[i] == goal then
        joined[i] = true
      end
    end
    joined_nodes[#joined_nodes + 1] = goal
    absorb()
  end
  return { poles = result_poles, wires = wires }, {}
end

return power
