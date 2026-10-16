--- M9f: a mining layout for an ore field. Worked out with the output facing east (engine/solve.lua turns
--- the problem so, and the result back):
---
---   drills  (facing south, mining down to the belt)
---   belt    (flows east)                                   ->  collector column  ->  output port
---   drills  (facing north)
---
--- Lines repeat every 2 x drill size + 1 tiles down the field; drills sit every drill size tiles along
--- it, where their mining area holds the ore (and no other ore: the drill would mine that too). All
--- belts end at one column; past it a short collector belt brings the lines above the middle line down
--- onto its north lane, the lines below up onto its south lane, and one routed belt takes the middle
--- line on to the output port. Each lane is planned at most rows.MAX_LANE_USE full.
local direction = require("engine.model.direction")
local fraction = require("engine.model.fraction")
local issues = require("engine.issues")
local rows = require("engine.placement.rows")

local mine = {}

local function key(x, y)
  return x .. "," .. y
end

--- Place the mining layout for a loaded problem (kind "mine", output facing east). Returns
--- { entities = drills and belts (blueprint entities), net = the net to the output port, rate (items/s,
--- a fraction), drills = count } or nil, issues.
function mine.place(p, pack)
  local o = p.output
  local drill_name = p.tiers.drill
  local drill = drill_name and pack.drills[drill_name]
  if not drill then
    return nil, { issues.new("unknown-tier", "no mining drill is known", "add tiers.drill to the problem") }
  end
  -- the ore that gives the output item, and every other ore
  local wanted, field, other = {}, {}, {}
  for name, res in pairs(pack.resources or {}) do
    for _, r in ipairs(res.results) do
      if r.name == o.item and r.type == "item" then
        wanted[name] = res
      end
    end
  end
  local per_drill, needs_fluid
  for _, t in ipairs(p.resources) do
    local res = wanted[t.name]
    if res then
      field[#field + 1] = t
      if res.fluid then
        needs_fluid = res.fluid
      end
      local amount = res.results[1].amount or 1
      per_drill = fraction.from(drill.mining_speed) / fraction.from(res.mining_time) * amount
    else
      other[key(t.x, t.y)] = true
    end
  end
  if #field == 0 then
    return nil,
      {
        issues.new(
          "no-ore",
          "there is no ore for " .. o.item .. " in the area",
          "select an area over an ore field of it, or pick another output"
        ),
      }
  end
  if needs_fluid then
    return nil,
      {
        issues.new(
          "fluid-ingredient",
          "mining " .. o.item .. " needs " .. needs_fluid,
          "pick another ore; fluids are not supported yet"
        ),
      }
  end
  local ore = {}
  local xmin, xmax, ymin, ymax = math.huge, -math.huge, math.huge, -math.huge
  for _, t in ipairs(field) do
    ore[key(t.x, t.y)] = true
    xmin, xmax = math.min(xmin, t.x), math.max(xmax, t.x)
    ymin, ymax = math.min(ymin, t.y), math.max(ymax, t.y)
  end

  -- tiles nothing may stand on: outside the area, obstacles, ports and the tiles in front of them
  local a = p.area
  local blocked = {}
  for _, t in ipairs(p.obstacles or {}) do
    blocked[key(t.x, t.y)] = true
  end
  for _, port in ipairs({ o }) do
    local tx, ty = math.floor(port.position.x), math.floor(port.position.y)
    blocked[key(tx, ty)] = true
  end
  local function free(x, y)
    return x >= a[1][1] and y >= a[1][2] and x < a[2][1] and y < a[2][2] and not blocked[key(x, y)]
  end

  local s = drill.size[1]
  local reach = math.floor(drill.radius + 0.5) -- tiles mined around the drill's centre tile
  local half = (s - 1) / 2
  -- a drill with its top-left tile at (x, y): free, mining wanted ore and nothing else
  local function drill_ok(x, y)
    for dx = 0, s - 1 do
      for dy = 0, s - 1 do
        if not free(x + dx, y + dy) then
          return false
        end
      end
    end
    local cx, cy = x + half, y + half
    local any = false
    for mx = cx - reach, cx + reach do
      for my = cy - reach, cy + reach do
        if other[key(mx, my)] then
          return false
        end
        any = any or ore[key(mx, my)] or false
      end
    end
    return any
  end

  -- candidate lines and drills
  local period = 2 * s + 1
  local lines = {}
  for yb = ymin + s, ymax + reach + s, period do
    local line = { y = yb, north = {}, south = {} }
    for x = xmin, xmax + reach, s do
      if drill_ok(x, yb - s) then
        line.north[#line.north + 1] = x
      end
      if drill_ok(x, yb + 1) then
        line.south[#line.south + 1] = x
      end
    end
    if #line.north + #line.south > 0 then
      lines[#lines + 1] = line
    end
  end
  if #lines == 0 then
    return nil,
      {
        issues.new(
          "no-ore",
          "no mining drill fits over the ore for " .. o.item .. " in the area",
          "select more of the ore field, and keep other ores out of it"
        ),
      }
  end

  -- which drills: the middle line first, then outwards; downstream (east) first along each line; while
  -- each lane of the middle line stays within its share
  local m = math.floor((#lines + 1) / 2)
  local lane = fraction.from(pack.belts[p.tiers.belt].items_per_second) / 2
  local lane_max = lane * rows.MAX_LANE_USE
  local want = (not o.rate_max) and o.rate or nil
  local order = {}
  for i, line in ipairs(lines) do
    for _, side in ipairs({ "north", "south" }) do
      for _, x in ipairs(line[side]) do
        order[#order + 1] = { line = i, side = side, x = x }
      end
    end
  end
  table.sort(order, function(p1, p2)
    local d1, d2 = math.abs(p1.line - m), math.abs(p2.line - m)
    if d1 ~= d2 then
      return d1 < d2
    end
    if p1.line ~= p2.line then
      return p1.line < p2.line
    end
    if p1.x ~= p2.x then
      return p1.x > p2.x
    end
    return p1.side < p2.side
  end)
  -- the middle line's north lane takes its north drills and every line above; south likewise
  local load = { north = fraction.new(0), south = fraction.new(0) }
  local chosen, count, rate = {}, 0, fraction.new(0)
  for _, c in ipairs(order) do
    if want and rate >= want then
      break
    end
    local lane_of = c.line < m and "north" or (c.line > m and "south" or c.side)
    if load[lane_of] + per_drill <= lane_max then
      load[lane_of] = load[lane_of] + per_drill
      chosen[#chosen + 1] = c
      count, rate = count + 1, rate + per_drill
    end
  end
  if want and rate < want then
    local belt_full = lane_max * 2
    if want > belt_full then
      return nil,
        {
          issues.new(
            "belt-too-slow",
            string.format("%s/s of %s is more than one %s carries", tostring(want), o.item, p.tiers.belt),
            "pick a faster belt tier, or a lower rate"
          ),
        }
    end
    return nil,
      {
        issues.new(
          "ore-field-too-small",
          string.format(
            "the ore field gives at most %s %s/s here (%d drills); %s/s was asked",
            tostring(rate),
            o.item,
            count,
            tostring(want)
          ),
          "select more of the ore field, or lower the rate"
        ),
      }
  end

  -- build: drills, a belt per line with drills, the collector, and the net to the output
  local used, last = {}, -math.huge
  for _, c in ipairs(chosen) do
    used[c.line] = used[c.line] or { north = {}, south = {}, first = math.huge }
    table.insert(used[c.line][c.side], c.x)
    used[c.line].first = math.min(used[c.line].first, c.x)
    last = math.max(last, c.x + s - 1)
  end
  used[m] = used[m] or { north = {}, south = {}, first = last }
  local X = last -- the column every line's belt ends at
  local entities = {}
  local function add(name, x, y, dir, w, h)
    local e = { name = name, position = { x = x + w / 2, y = y + h / 2 } }
    if dir ~= direction.NORTH then
      e.direction = dir
    end
    entities[#entities + 1] = e
  end
  local first_line, last_line = math.huge, -math.huge
  local problems = {}
  local function belt(x, y, dir)
    if not free(x, y) then
      problems[#problems + 1] = string.format("%d, %d", x, y)
    end
    add(p.tiers.belt, x, y, dir, 1, 1)
  end
  for i = 1, #lines do
    local u = used[i]
    if u then
      local yb = lines[i].y
      first_line, last_line = math.min(first_line, i), math.max(last_line, i)
      for _, x in ipairs(u.north) do
        add(drill_name, x, yb - s, direction.SOUTH, s, s)
      end
      for _, x in ipairs(u.south) do
        add(drill_name, x, yb + 1, direction.NORTH, s, s)
      end
      for x = math.min(u.first, X), X do
        belt(x, yb, direction.EAST)
      end
    end
  end
  -- the collector: one column past the lines' ends; the middle line runs on through it
  local ym = lines[m].y
  belt(X + 1, ym, direction.EAST)
  for y = lines[first_line].y, ym - 1 do
    belt(X + 1, y, direction.SOUTH)
  end
  for y = ym + 1, lines[last_line].y do
    belt(X + 1, y, direction.NORTH)
  end
  if #problems > 0 then
    return nil,
      {
        issues.new(
          "ports-in-the-way",
          "the mining belts need tiles that are blocked or outside the area: " .. problems[1],
          "make the area larger around the ore field, or clear what is in the way"
        ),
      }
  end
  local net = {
    item = o.item,
    from = { x = X + 2, y = ym, dir = direction.EAST, from_x = X + 1, from_y = ym, label = "mining belts" },
    goals = { { x = math.floor(o.position.x), y = math.floor(o.position.y), dirs = nil } },
    label = "mining belts -> output port",
  }
  return { entities = entities, net = net, rate = rate, drills = count }
end

return mine
