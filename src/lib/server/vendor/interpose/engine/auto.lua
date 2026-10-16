--- M9e: a layout from only an output port. The engine works out which items must come in (whatever
--- the machine cannot make: plates, wood, ...), and proposes areas upstream of the output: the output
--- port on one edge, the input ports on the opposite edge facing it, in a row centred across the flow.
--- Each candidate is a little larger than the one before; solve.run_auto (and the mod, over ticks) tries
--- them in order until one fits and routes.
local direction = require("engine.model.direction")
local problem_mod = require("engine.problem")
local ratios = require("engine.ratios")
local rows = require("engine.placement.rows")
local fraction = require("engine.model.fraction")
local issues = require("engine.issues")

local auto = {}

auto.STEPS = 5 -- candidates at most
auto.GROW = 4 -- tiles added each way per candidate
auto.MAX_SIDE = 100 -- as the mod's largest selection
-- refusals a larger area may fix
auto.RETRY = { ["area-too-small"] = true, ["ports-in-the-way"] = true, ["no-route"] = true }

local function copy(t)
  if type(t) ~= "table" then
    return t
  end
  local c = {}
  for k, v in pairs(t) do
    c[k] = copy(v)
  end
  return c
end

-- the input ports for `items` across the flow, `dist` tiles upstream of the output tile
local function inputs_at(items, ox, oy, d, dist)
  local v, u = direction.vector(d), direction.vector((d + 4) % 16)
  local out = {}
  for i, item in ipairs(items) do
    local lateral = 2 * (i - 1) - (#items - 1)
    local x = ox - v.x * dist + u.x * lateral
    local y = oy - v.y * dist + u.y * lateral
    out[i] = { item = item, position = { x = x + 0.5, y = y + 0.5 }, direction = d }
  end
  return out
end

-- the area: `len` tiles along the flow ending at the output tile, `wide` tiles across, centred on it
local function area_of(ox, oy, d, len, wide)
  local v, u = direction.vector(d), direction.vector((d + 4) % 16)
  local a = -math.floor(wide / 2)
  local b = a + wide - 1
  local xs = { ox, ox - v.x * (len - 1), ox + u.x * a, ox + u.x * b }
  local ys = { oy, oy - v.y * (len - 1), oy + u.y * a, oy + u.y * b }
  local x1, x2 = math.min(xs[1], xs[2], xs[3], xs[4]), math.max(xs[1], xs[2], xs[3], xs[4])
  local y1, y2 = math.min(ys[1], ys[2], ys[3], ys[4]), math.max(ys[1], ys[2], ys[3], ys[4])
  return { { x1, y1 }, { x2 + 1, y2 + 1 } }
end

--- Candidate problems for a raw problem with an output and "auto_inputs": true (its inputs are
--- ignored). With an area (the player's selection), only candidates inside it are kept: Interpose never
--- builds outside the selection (#21); none fits: "area-too-small" with the size needed. Returns
--- { list of raw problems, items = the input items } or nil, issues.
function auto.candidates(raw, pack)
  if type(raw) ~= "table" or type(raw.output) ~= "table" or type(raw.output.position) ~= "table" then
    return nil, { issues.new("missing-output", "mark the product with an output port", "the problem has no output") }
  end
  local o = raw.output
  local ox, oy = math.floor(o.position.x or 0), math.floor(o.position.y or 0)
  local d = o.direction or direction.NORTH
  if not direction.is_cardinal(d) then
    return nil,
      {
        issues.new(
          "bad-direction",
          "use north, east, south or west",
          "the output's direction is not one of 0, 4, 8, 12"
        ),
      }
  end
  -- what comes in: a probe with a generous area and no inputs
  local probe = copy(raw)
  probe.inputs, probe.auto_inputs = {}, true
  probe.area = area_of(ox, oy, d, auto.MAX_SIDE, auto.MAX_SIDE)
  local p, errors = problem_mod.load(probe, pack)
  if not p then
    return nil, errors
  end
  if p.output.rate_max then
    p.output.rate = fraction.new(1)
  end
  local plan
  plan, errors = ratios.solve(p, pack)
  if not plan then
    return nil, errors
  end
  local items = plan.leaves
  if #items == 0 then
    return nil,
      {
        issues.new(
          "output-not-craftable",
          "nothing would come in to make " .. o.item,
          "pick an output made from items"
        ),
      }
  end
  -- how big the machines are: place them for real, inputs at their spot
  probe.auto_inputs = nil
  probe.inputs = inputs_at(items, ox, oy, d, auto.MAX_SIDE - 1)
  p, errors = problem_mod.load(probe, pack)
  if not p then
    return nil, errors
  end
  if p.output.rate_max then
    -- as solve does: plan for 1 item/s, then scale to the most the belts carry
    p.output.rate = fraction.new(1)
    local unit = assert(ratios.solve(p, pack))
    p.output.rate = rows.max_rate(unit, p, pack)
  end
  plan, errors = ratios.solve(p, pack)
  if not plan then
    return nil, errors
  end
  local layout
  layout, errors = rows.place(plan, p, pack)
  local need_w, need_h
  if layout then
    need_w, need_h = layout.size[1], layout.size[2]
  else
    for _, e in ipairs(errors) do
      if e.code == "area-too-small" and e.size then
        need_w, need_h = e.size.w, e.size.h
      end
    end
    if not need_w then
      local fatal = {}
      for _, e in ipairs(errors) do
        if not auto.RETRY[e.code] then
          fatal[#fatal + 1] = e
        end
      end
      if #fatal > 0 then
        return nil, fatal
      end
      need_w, need_h = 20, 20
    end
  end
  -- rows flow along the output's direction: the length follows their width, the breadth their height;
  -- room for the belts from the inputs (and for 2 tiles per input port across)
  local list = {}
  for k = 0, auto.STEPS - 1 do
    local len = math.min(auto.MAX_SIDE, need_w + 2 + auto.GROW * k)
    local wide = math.min(auto.MAX_SIDE, math.max(need_h, 2 * #items + 1) + 2 + auto.GROW * k)
    local c = copy(raw)
    c.auto_inputs = nil
    c.area = area_of(ox, oy, d, len, wide)
    c.inputs = inputs_at(items, ox, oy, d, len - 1)
    local sel = raw.area
    local inside = type(sel) ~= "table"
      or (
        c.area[1][1] >= sel[1][1]
        and c.area[1][2] >= sel[1][2]
        and c.area[2][1] <= sel[2][1]
        and c.area[2][2] <= sel[2][2]
      )
    if inside then
      list[#list + 1] = c
    end
    if len == auto.MAX_SIDE and wide == auto.MAX_SIDE then
      break
    end
  end
  if #list == 0 then
    local len = need_w + 2
    local wide = math.max(need_h, 2 * #items + 1) + 2
    local along = d == direction.EAST or d == direction.WEST
    local w, h = along and len or wide, along and wide or len
    local side = ({
      [direction.EAST] = "left",
      [direction.WEST] = "right",
      [direction.NORTH] = "below",
      [direction.SOUTH] = "above",
    })[d]
    local e = issues.new(
      "area-too-small",
      string.format(
        "only an output port: Interpose needs about %d wide x %d tall %s it, inside the selection",
        w,
        h,
        side
      ),
      "drag a larger area, reaching that far " .. side .. " the output port; Interpose builds only inside it"
    )
    e.size = { w = w, h = h }
    return nil, { e }
  end
  return { candidates = list, items = items }
end

return auto
