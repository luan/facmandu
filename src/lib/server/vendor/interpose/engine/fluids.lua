--- M13: fluids. Pipes from fluid inputs to fluid outputs, never letting two fluids touch.
---
--- In the game, fluid entities next to each other join when both have a connection facing the other:
--- a pipe has one on all four sides, a pipe-to-ground only on its open side (its `direction`) and
--- under the ground towards its partner. Two fluids that join mix, and untangling that costs the
--- player a lot of time. So the router never puts a piece where it would face a piece of another fluid
--- that faces it back, and the validator checks the result network by network.
---
--- Problem (kind "fluid"): inputs and outputs {fluid, position, direction} (a pipe on that tile; the
--- fluid enters an input moving `direction`, and leaves an output moving `direction`), area, obstacles
--- (tiles nothing may stand on; pipes may pass under them with pipe-to-ground), tiers {pipe,
--- underground}. Every output needs an input of its fluid. Outputs of a fluid that is already piped
--- branch off that fluid's pipes.
local direction = require("engine.model.direction")
local heap = require("engine.model.heap")
local issues = require("engine.issues")

local fluids = {}

local function key(x, y)
  return x .. "," .. y
end

local DIRS = { direction.NORTH, direction.EAST, direction.SOUTH, direction.WEST }

local function vec(d)
  return direction.vector(d)
end

local function back(d)
  return (d + 8) % 16
end

-- does the piece at tile (x, y) have a connection facing the neighbouring tile in direction d?
local function faces(piece, d)
  if piece.kind == "pipe" then
    return true
  end
  return piece.dir == d -- pipe-to-ground: only its open side
end

--- Load and check a fluid problem. Returns problem or nil, issues.
function fluids.load(raw, pack)
  local errs = {}
  local function err(code, message, hint)
    errs[#errs + 1] = issues.new(code, message, hint)
  end
  local p = { kind = "fluid", inputs = {}, outputs = {}, area = raw.area, obstacles = raw.obstacles or {} }
  local t = raw.tiers or {}
  p.tiers = { pipe = t.pipe or "pipe", underground = t.underground or "pipe-to-ground" }
  if not (pack.pipes and pack.pipes[p.tiers.pipe]) then
    err("unknown-tier", "the game pack knows no pipe " .. tostring(p.tiers.pipe), "set tiers.pipe, e.g. pipe")
  end
  local ug = pack.pipes and pack.pipes[p.tiers.underground]
  if not (ug and ug.underground) then
    err(
      "unknown-tier",
      "the game pack knows no pipe-to-ground " .. tostring(p.tiers.underground),
      "set tiers.underground, e.g. pipe-to-ground"
    )
  end
  p.reach = ug and ug.underground or 0
  if type(raw.area) ~= "table" then
    err("bad-area", "a fluid problem needs an area", "add area: [[x1, y1], [x2, y2]]")
  end
  local fluids_in = {}
  for _, list in ipairs({ { raw.inputs, p.inputs }, { raw.outputs, p.outputs } }) do
    for _, port in ipairs(list[1] or {}) do
      list[2][#list[2] + 1] = {
        fluid = port.fluid,
        x = math.floor(port.position.x),
        y = math.floor(port.position.y),
        dir = port.direction or 0,
        position = port.position,
        direction = port.direction or 0,
      }
    end
  end
  for _, inp in ipairs(p.inputs) do
    fluids_in[inp.fluid] = true
  end
  -- ports are pipes: two of different fluids side by side would join before any pipe is laid
  local all = {}
  for _, list in ipairs({ p.inputs, p.outputs }) do
    for _, port in ipairs(list) do
      all[#all + 1] = port
    end
  end
  for i, u in ipairs(all) do
    for j = i + 1, #all do
      local w = all[j]
      if u.fluid ~= w.fluid and math.abs(u.x - w.x) + math.abs(u.y - w.y) == 1 then
        err(
          "fluid-ports-touch",
          string.format("the %s and %s ports are next to each other: their pipes would join", u.fluid, w.fluid),
          "leave at least one tile between ports of different fluids"
        )
      end
    end
  end
  if #p.outputs == 0 then
    err("missing-output", "a fluid problem needs an output", "add an output with a fluid")
  end
  for _, o in ipairs(p.outputs) do
    if not fluids_in[o.fluid] then
      err("missing-input", "nothing supplies " .. tostring(o.fluid), "add an input for " .. tostring(o.fluid))
    end
  end
  if #errs > 0 then
    return nil, errs
  end
  return p, {}
end

--- Route the pipes. Returns entities (blueprint entities without entity_number) or nil, issues.
function fluids.route(p)
  local a = p.area
  local blocked = {}
  for _, t in ipairs(p.obstacles) do
    blocked[key(t.x, t.y)] = true
  end
  -- placed pieces by tile: {kind = "pipe" | "ug", dir (ug: open side), fluid}
  local placed = {}
  local entities = {}
  local ug_rows, ug_columns = {}, {} -- sorted committed endpoints by axis
  local function remember(index, axis, position)
    local list = index[axis] or {}
    list[#list + 1] = position
    table.sort(list)
    index[axis] = list
  end
  local function inside(x, y)
    return x >= a[1][1] and y >= a[1][2] and x < a[2][1] and y < a[2][2]
  end
  local function put(x, y, piece)
    placed[key(x, y)] = piece
    if piece.kind == "pipe" then
      entities[#entities + 1] = { name = p.tiers.pipe, position = { x = x + 0.5, y = y + 0.5 } }
    else
      local e = { name = p.tiers.underground, position = { x = x + 0.5, y = y + 0.5 } }
      if piece.dir ~= 0 then
        e.direction = piece.dir
      end
      entities[#entities + 1] = e
      if piece.dir % 8 == 0 then remember(ug_columns, x, y) else remember(ug_rows, y, x) end
    end
  end
  -- the ports are pipes of their fluid from the start: other fluids keep away from them
  for _, port in ipairs(p.inputs) do
    if not placed[key(port.x, port.y)] then
      put(port.x, port.y, { kind = "pipe", fluid = port.fluid })
    end
  end
  for _, port in ipairs(p.outputs) do
    if not placed[key(port.x, port.y)] then
      put(port.x, port.y, { kind = "pipe", fluid = port.fluid })
    end
  end
  -- may a piece of `fluid` stand on (x, y)? `open`: the directions it has a connection on (a pipe:
  -- all four). It must not face, or be faced by, a piece of another fluid.
  local function free(x, y)
    return inside(x, y) and not blocked[key(x, y)] and not placed[key(x, y)]
  end
  local function safe(x, y, fluid, open, extra)
    for _, d in ipairs(DIRS) do
      local v = vec(d)
      local nk = key(x + v.x, y + v.y)
      local n = placed[nk] or (extra and extra[nk])
      if n and n.fluid ~= fluid then
        -- they join when both face each other
        if open[d] and faces(n, back(d)) then
          return false
        end
      end
    end
    return true
  end
  local ALL = { [direction.NORTH] = true, [direction.EAST] = true, [direction.SOUTH] = true, [direction.WEST] = true }
  -- would a pipe-to-ground pair from (x1, y1) to (x2, y2) on an axis cross another pair's line, or
  -- would a pipe-to-ground land between another pair? (pairs join with the nearest one in line)
  local function between(list, first, last)
    local lo, hi = 1, #(list or {})
    while lo <= hi do
      local mid = math.floor((lo + hi) / 2)
      if list[mid] <= first then lo = mid + 1 else hi = mid - 1 end
    end
    return list and list[lo] ~= nil and list[lo] < last
  end
  local function ug_line_clear(x1, y1, x2, y2, route_ugs)
    if x1 == x2 and between(ug_columns[x1], math.min(y1, y2), math.max(y1, y2)) then return false end
    if y1 == y2 and between(ug_rows[y1], math.min(x1, x2), math.max(x1, x2)) then return false end
    for _, u in ipairs(route_ugs) do
      if x1 == x2 and u.dir % 8 == 0 and u.x == x1 and u.y > math.min(y1, y2) and u.y < math.max(y1, y2) then return false end
      if y1 == y2 and u.dir % 8 == 4 and u.y == y1 and u.x > math.min(x1, x2) and u.x < math.max(x1, x2) then return false end
    end
    return true
  end
  local function lands_between_pair(x, y, axis_vertical, route_ugs)
    -- a new pipe-to-ground on the axis of an existing pair, between its ends
    local list = axis_vertical and ug_columns[x] or ug_rows[y]
    local lowest, highest = list and list[1], list and list[#list]
    for _, u in ipairs(route_ugs) do
      if (axis_vertical and u.dir % 8 == 0 and u.x == x) or (not axis_vertical and u.dir % 8 == 4 and u.y == y) then
        local position = axis_vertical and u.y or u.x
        lowest = math.min(lowest or position, position)
        highest = math.max(highest or position, position)
      end
    end
    local position = axis_vertical and y or x
    return lowest ~= nil and lowest < position and position < highest
  end

  -- every output, in a fixed order: sorted by fluid, then position
  local order = {}
  for _, o in ipairs(p.outputs) do
    order[#order + 1] = o
  end
  table.sort(order, function(u, v)
    if u.fluid ~= v.fluid then
      return u.fluid < v.fluid
    end
    if u.y ~= v.y then
      return u.y < v.y
    end
    return u.x < v.x
  end)
  local connected = {} -- tiles joined to a fluid's input, per fluid
  for _, inp in ipairs(p.inputs) do
    connected[inp.fluid] = connected[inp.fluid] or {}
    connected[inp.fluid][key(inp.x, inp.y)] = { x = inp.x, y = inp.y }
  end
  for _, o in ipairs(order) do
    local F = o.fluid
    -- already joined (an output next to the network)?
    local done_already = false
    for _, d in ipairs(DIRS) do
      local v = vec(d)
      local n = connected[F][key(o.x + v.x, o.y + v.y)]
      local piece = n and placed[key(n.x, n.y)]
      if piece and faces(piece, back(d)) then
        done_already = true
      end
    end
    if not done_already then
      -- A*: a node is a placed piece of fluid F from which the pipe goes on: a pipe (any side) or the
      -- exit of a pipe-to-ground (only straight on)
      local open = heap.new()
      local parent = {}
      local seen = {}
      local function h(x, y)
        return math.abs(x - o.x) + math.abs(y - o.y)
      end
      local starts = {}
      for _, t in pairs(connected[F]) do starts[#starts + 1] = t end
      table.sort(starts, function(u, v) return u.y < v.y or (u.y == v.y and u.x < v.x) end)
      for _, t in ipairs(starts) do
        local piece = placed[key(t.x, t.y)]
        local id = "s" .. key(t.x, t.y)
        parent[id] = { start = true }
        heap.push(open, h(t.x, t.y), { id = id, x = t.x, y = t.y, g = 0, piece = piece })
      end
      local found
      local expansions = 0
      while not heap.empty(open) do
        local cur = heap.pop(open)
        ---@cast cur -nil
        expansions = expansions + 1
        if expansions > 200000 then
          break
        end
        -- reached: the current piece faces the output, which faces it back (a pipe)
        local dx, dy = o.x - cur.x, o.y - cur.y
        if math.abs(dx) + math.abs(dy) == 1 then
          local d = (dx == 1 and direction.EAST)
            or (dx == -1 and direction.WEST)
            or (dy == 1 and direction.SOUTH)
            or direction.NORTH
          if faces(cur.piece, d) then
            found = cur
            break
          end
        end
        -- Search paths are not committed yet; their own endpoints must stay occupied too.
        local pending, route_ugs = {}, {}
        local ancestor = cur.id
        while parent[ancestor] and not parent[ancestor].start do
          local step = parent[ancestor]
          pending[key(step.x, step.y)] = true
          if step.kind == "ug" then
            pending[key(step.ex, step.ey)] = true
            route_ugs[#route_ugs + 1] = { x = step.x, y = step.y, dir = back(step.dir) }
            route_ugs[#route_ugs + 1] = { x = step.ex, y = step.ey, dir = step.dir }
          end
          ancestor = step.from
        end
        local dirs = cur.piece.kind == "pipe" and DIRS or { cur.piece.dir }
        for _, d in ipairs(dirs) do
          local v = vec(d)
          local tx, ty = cur.x + v.x, cur.y + v.y
          if free(tx, ty) and not pending[key(tx, ty)] then
            -- a pipe on (tx, ty)
            local id = "p" .. key(tx, ty)
            if not seen[id] and safe(tx, ty, F, ALL) then
              seen[id] = true
              parent[id] = { from = cur.id, kind = "pipe", x = tx, y = ty }
              local g = cur.g + 1
              heap.push(open, g + h(tx, ty), { id = id, x = tx, y = ty, g = g, piece = { kind = "pipe", fluid = F } })
            end
            -- a pipe-to-ground pair: entry on (tx, ty) open towards cur, exit k tiles on, open onwards
            local entry_open = { [back(d)] = true }
            if safe(tx, ty, F, entry_open) and not lands_between_pair(tx, ty, v.x == 0, route_ugs) then
              for k = 2, p.reach do
                local ex, ey = tx + v.x * k, ty + v.y * k
                if not inside(ex, ey) then
                  break
                end
                local eid = "u" .. key(tx, ty) .. ">" .. key(ex, ey)
                if
                  free(ex, ey)
                  and not pending[key(ex, ey)]
                  and not seen[eid]
                  and safe(ex, ey, F, { [d] = true })
                  and ug_line_clear(tx, ty, ex, ey, route_ugs)
                  and not lands_between_pair(ex, ey, v.x == 0, route_ugs)
                then
                  seen[eid] = true
                  parent[eid] = { from = cur.id, kind = "ug", x = tx, y = ty, ex = ex, ey = ey, dir = d }
                  local g = cur.g + 3
                  heap.push(
                    open,
                    g + h(ex, ey),
                    { id = eid, x = ex, y = ey, g = g, piece = { kind = "ug", dir = d, fluid = F } }
                  )
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
              "no-route",
              "no pipe route for "
                .. F
                .. " to its output at "
                .. o.x
                .. ", "
                .. o.y
                .. " without touching another fluid",
              "make the area larger, or move the ports apart: pipes of different fluids must not touch"
            ),
          }
      end
      local chain = {}
      local id = found.id
      while parent[id] and not parent[id].start do
        table.insert(chain, 1, parent[id])
        id = parent[id].from
      end
      for _, step in ipairs(chain) do
        if step.kind == "pipe" then
          put(step.x, step.y, { kind = "pipe", fluid = F })
          connected[F][key(step.x, step.y)] = { x = step.x, y = step.y }
        else
          put(step.x, step.y, { kind = "ug", dir = back(step.dir), fluid = F })
          put(step.ex, step.ey, { kind = "ug", dir = step.dir, fluid = F })
          connected[F][key(step.x, step.y)] = { x = step.x, y = step.y }
          connected[F][key(step.ex, step.ey)] = { x = step.ex, y = step.ey }
        end
      end
    end
    connected[F][key(o.x, o.y)] = { x = o.x, y = o.y }
  end
  return entities, {}
end

--- Check pipes: which pieces join (both face each other; pipe-to-ground pairs under the ground), and
--- that no network holds two fluids and every output's network holds its fluid's input.
--- entities: blueprint entities (pipes and pipe-to-ground); inputs/outputs as in the problem.
--- Returns {ok, errors = issues}.
function fluids.validate(entities, p, pack)
  local pieces = {}
  local list = {}
  local errors = {}
  for _, e in ipairs(entities) do
    local x, y = math.floor(e.position.x), math.floor(e.position.y)
    local piece = { x = x, y = y }
    if pack.pipes[e.name] and pack.pipes[e.name].underground then
      piece.kind, piece.dir, piece.reach = "ug", e.direction or 0, pack.pipes[e.name].underground
    else
      piece.kind = "pipe"
    end
    if pieces[key(x, y)] then
      errors[#errors + 1] = issues.new("overlap", "fluid pieces overlap at " .. x .. ", " .. y,
        "route each fluid entity onto a distinct tile")
    end
    pieces[key(x, y)] = piece
    list[#list + 1] = piece
  end
  local parent = {}
  local function find(k)
    while parent[k] and parent[k] ~= k do
      k = parent[k]
    end
    return k
  end
  local function union(a, b)
    local ra, rb = find(a), find(b)
    if ra ~= rb then
      parent[ra] = rb
    end
  end
  for _, piece in ipairs(list) do
    local k = key(piece.x, piece.y)
    parent[k] = parent[k] or k
    for _, d in ipairs(DIRS) do
      local v = vec(d)
      local nk = key(piece.x + v.x, piece.y + v.y)
      local n = pieces[nk]
      if n and faces(piece, d) and faces(n, back(d)) then
        parent[nk] = parent[nk] or nk
        union(k, nk)
      end
    end
    if piece.kind == "ug" then
      -- the partner: the nearest pipe-to-ground under the ground (away from the open side), facing back
      local u = (piece.dir + 8) % 16
      local v = vec(u)
      for k2 = 1, piece.reach do
        local n = pieces[key(piece.x + v.x * k2, piece.y + v.y * k2)]
        if n and n.kind == "ug" and n.dir % 8 == piece.dir % 8 then
          if n.dir == u then
            local nk = key(n.x, n.y)
            parent[nk] = parent[nk] or nk
            union(k, nk)
          end
          break
        end
      end
    end
  end
  local fluid_of = {}
  for _, port in ipairs(p.inputs) do
    local r = find(key(port.x, port.y))
    if fluid_of[r] and fluid_of[r] ~= port.fluid then
      errors[#errors + 1] = issues.new(
        "fluids-mix",
        port.fluid .. " and " .. fluid_of[r] .. " are in one pipe network",
        "keep pipes of different fluids apart"
      )
    end
    fluid_of[r] = port.fluid
  end
  for _, port in ipairs(p.outputs) do
    local r = find(key(port.x, port.y))
    if fluid_of[r] ~= port.fluid then
      errors[#errors + 1] = issues.new(
        fluid_of[r] and "fluids-mix" or "output-unfed",
        "the output for "
          .. port.fluid
          .. " at "
          .. port.x
          .. ", "
          .. port.y
          .. " gets "
          .. tostring(fluid_of[r] or "nothing"),
        "route a pipe from the " .. port.fluid .. " input"
      )
    end
  end
  return { ok = #errors == 0, errors = errors }
end

--- Solve a fluid problem: returns result {blueprint, report, plan, layout, warnings} or nil, issues.
function fluids.solve(raw, pack)
  local p, errors = fluids.load(raw, pack)
  if not p then
    return nil, errors
  end
  local entities
  entities, errors = fluids.route(p)
  if not entities then
    return nil, errors
  end
  for i, e in ipairs(entities) do
    e.entity_number = i
  end
  local report = fluids.validate(entities, p, pack)
  if not report.ok then
    return nil,
      {
        issues.new(
          "internal",
          "the pipes do not validate: " .. report.errors[1].message,
          "please report this, with the problem file"
        ),
      }
  end
  local label = {}
  for _, o in ipairs(p.outputs) do
    label[#label + 1] = o.fluid
  end
  return {
    blueprint = {
      blueprint = {
        item = "blueprint",
        label = "Interpose: pipes for " .. table.concat(label, ", "),
        entities = entities,
      },
    },
    report = report,
    plan = { steps = {}, inputs = {}, warnings = {} },
    layout = { rows = {}, entities = entities },
    warnings = {},
  }, {}
end

return fluids
