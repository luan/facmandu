--- The whole pipeline (F5): problem file -> ratios -> row placement -> routing -> validated blueprint.
local problem_mod = require("engine.problem")
local ratios = require("engine.ratios")
local rows = require("engine.placement.rows")
local routing = require("engine.routing.init")
local blueprint = require("engine.blueprint")
local validate = require("engine.validate.init")
local issues = require("engine.issues")
local direction = require("engine.model.direction")
local balancer = require("engine.placement.balancer")
local origin = require("engine.placement.origin")
local fraction = require("engine.model.fraction")
local transform = require("engine.model.transform")
local auto = require("engine.auto")
local mine = require("engine.placement.mine")
local power = require("engine.power")

local solve = {}

local function port_entity(name, def)
  local e = { name = name, position = { x = def.position.x, y = def.position.y }, tags = {} }
  e.tags[blueprint.PORT_ITEM_TAG] = def.item
  if def.direction ~= 0 then
    e.direction = def.direction
  end
  return e
end

--- Solve a problem table. Returns result, issues. result = {
---   blueprint = {blueprint = {item, label, entities}}, report = validator report,
---   plan = ratios plan, layout = rows layout, warnings = issues worth showing (unused inputs) }
--- On failure result is nil and the issues (engine/issues.lua) say what is wrong and what to change.
--- Transport: move input items to output ports unchanged. An item on one input and one output gets a
--- straight route; any other count gets a balancer block (engine/placement/balancer.lua) in between.
--- Returns attempt number attempt_no (1 to 4: a single balancer is tried in each orientation) as
--- {base = entities, nets = nets to route}, or nil and issues; third value: whether attempt attempt_no + 1 exists.
--- Everything is worked out again from the problem for each attempt, so a job keeps only the attempt's number.
local function transport(p, attempt_no)
  local base = {}
  for _, inp in ipairs(p.inputs) do
    base[#base + 1] = port_entity(blueprint.INPUT_PORT, inp)
  end
  for _, o in ipairs(p.outputs) do
    base[#base + 1] = port_entity(blueprint.OUTPUT_PORT, o)
  end
  local function by_position(a, b)
    if a.position.y ~= b.position.y then
      return a.position.y < b.position.y
    end
    return a.position.x < b.position.x
  end
  local ins, outs, items = {}, {}, {}
  for _, inp in ipairs(p.inputs) do
    ins[inp.item] = ins[inp.item] or {}
    table.insert(ins[inp.item], inp)
  end
  for _, o in ipairs(p.outputs) do
    if not outs[o.item] then
      items[#items + 1] = o.item
    end
    outs[o.item] = outs[o.item] or {}
    table.insert(outs[o.item], o)
  end
  table.sort(items)

  local function source(inp)
    local v = direction.vector(inp.direction)
    local tx, ty = math.floor(inp.position.x), math.floor(inp.position.y)
    return {
      x = tx + v.x,
      y = ty + v.y,
      dir = inp.direction,
      from_x = tx,
      from_y = ty,
      label = "input port " .. inp.item,
    }
  end
  local function port_goal(o)
    return { { x = math.floor(o.position.x), y = math.floor(o.position.y), dirs = routing.into_port(o) } }
  end

  local nets, blocks = {}, {}
  for _, item in ipairs(items) do
    local i_list, o_list = ins[item], outs[item]
    table.sort(i_list, by_position)
    table.sort(o_list, by_position)
    if #i_list == 1 and #o_list == 1 then
      nets[#nets + 1] = {
        item = item,
        from = source(i_list[1]),
        goals = port_goal(o_list[1]),
        label = "input port " .. item .. " -> output port",
      }
    else
      if not p.tiers.splitter then
        return nil,
          { issues.new("unknown-tier", "no splitter goes with " .. p.tiers.belt, "add tiers.splitter to the problem") }
      end
      -- problem.load already refused counts without a balancer
      blocks[#blocks + 1] =
        { item = item, ins = i_list, outs = o_list, block = assert(balancer.block(#i_list, #o_list)) }
    end
  end

  -- each balancer faces the way its items flow (from the inputs towards the outputs) first; if that
  -- does not route, the other three orientations are tried
  local function centre(list)
    local x, y = 0, 0
    for _, port in ipairs(list) do
      x, y = x + port.position.x, y + port.position.y
    end
    return x / #list, y / #list
  end
  local function preferred(b)
    local ix, iy = centre(b.ins)
    local ox, oy = centre(b.outs)
    local dx, dy = ox - ix, oy - iy
    local first
    if math.abs(dx) >= math.abs(dy) then
      first = dx >= 0 and direction.EAST or direction.WEST
    else
      first = dy >= 0 and direction.SOUTH or direction.NORTH
    end
    return { first, (first + 4) % 16, (first + 12) % 16, (first + 8) % 16 }
  end
  local function attempt(choice)
    local all_base, all_nets, avoid = {}, {}, {}
    for _, e in ipairs(base) do
      all_base[#all_base + 1] = e
    end
    for _, n in ipairs(nets) do
      all_nets[#all_nets + 1] = n
    end
    for bi, b in ipairs(blocks) do
      local block = balancer.oriented(b.block, choice[bi])
      local at = origin.choose(p, block.width, block.height, 2, avoid)
      if not at then
        return nil,
          {
            issues.new(
              "ports-in-the-way",
              string.format("no spot for the %s balancer stays clear of the ports", b.item),
              "move the ports to the edges of the area, or make the area larger"
            ),
          }
      end
      local bx, by = at[1], at[2]
      avoid[#avoid + 1] = { x = bx, y = by, w = block.width, h = block.height }
      for _, e in ipairs(balancer.entities(block, bx, by, p.tiers)) do
        all_base[#all_base + 1] = e
      end
      -- inputs and outputs are matched to the block's terminals in order along the block's side
      local function along(list, d)
        table.sort(list, function(a, c)
          local ka = (d == direction.EAST or d == direction.WEST) and a.position.y or a.position.x
          local kc = (d == direction.EAST or d == direction.WEST) and c.position.y or c.position.x
          if ka ~= kc then
            return ka < kc
          end
          return (a.position.x + a.position.y) < (c.position.x + c.position.y)
        end)
        return list
      end
      local function terminals(list, d)
        local sorted = {}
        for _, t in ipairs(list) do
          sorted[#sorted + 1] = t
        end
        table.sort(sorted, function(a, c)
          if d == direction.EAST or d == direction.WEST then
            return a.y < c.y
          end
          return a.x < c.x
        end)
        return sorted
      end
      local ins_sorted, outs_sorted = along(b.ins, choice[bi]), along(b.outs, choice[bi])
      local t_in, t_out = terminals(block.inputs, choice[bi]), terminals(block.outputs, choice[bi])
      for k, inp in ipairs(ins_sorted) do
        local t = t_in[k]
        local v = direction.vector(t.dir)
        all_nets[#all_nets + 1] = {
          item = b.item,
          from = source(inp),
          goals = { { x = bx + t.x, y = by + t.y, dirs = { [t.dir] = true } } },
          reserve = { { x = bx + t.x - v.x, y = by + t.y - v.y } },
          label = "input port " .. b.item .. " " .. k .. " -> balancer",
        }
      end
      for k, o in ipairs(outs_sorted) do
        local t = t_out[k] -- the tile items leave the block to
        all_nets[#all_nets + 1] = {
          item = b.item,
          from = {
            x = bx + t.x,
            y = by + t.y,
            dir = t.dir,
            from_x = bx + t.feeder[1],
            from_y = by + t.feeder[2],
            label = b.item .. " balancer output " .. k,
          },
          goals = port_goal(o),
          label = b.item .. " balancer output " .. k .. " -> output port",
        }
      end
    end
    return { base = all_base, nets = all_nets }
  end
  local choice = {}
  for bi, b in ipairs(blocks) do
    choice[bi] = preferred(b)[1]
  end
  -- one balancer: its other orientations are attempts 2 to 4
  if attempt_no > 1 then
    choice[1] = preferred(blocks[1])[attempt_no]
  end
  local result, errors = attempt(choice)
  return result, errors, #blocks == 1 and attempt_no < 4
end

--- A transport layout's plan: no machines, warnings for inputs no output needs.
local function transport_plan(p)
  local outs = {}
  for _, o in ipairs(p.outputs) do
    outs[o.item] = true
  end
  local warnings = {}
  for _, inp in ipairs(p.inputs) do
    if not outs[inp.item] then
      warnings[#warnings + 1] = issues.new(
        "unused-input",
        "the input port for " .. inp.item .. " is not needed",
        "remove it, or add an output for it"
      )
    end
  end
  return { steps = {}, inputs = {}, warnings = warnings }, { rows = {}, entities = {} }
end

--- A solve job, done in steps so the game never has to wait for a whole solve (no coroutines in
--- Factorio's Lua). The job is plain data (no functions), so the mod can keep it in storage across
--- ticks and saves; the pack is passed to every step. job_step does the quick stages at once and runs
--- the belt routing for up to `budget` search steps; it returns the steps used. When job.done:
--- job.result (see solve.finish) or nil and job.errors.
function solve.job_new(raw_problem)
  return { phase = "start", raw = raw_problem }
end

local function done(job, result, errors)
  job.done, job.result, job.errors = true, result, errors
  job.route, job.raw, job.errors_of, job.retry = nil, nil, nil, nil
end

-- set up transport attempt job.k (or the next one that can be set up) and its routing
local function start_transport_attempt(job, pack)
  while true do
    local r, errors, more = transport(job.p, job.k)
    if r then
      job.base = r.base
      job.route = routing.route_new(r.nets, r.base, job.p, pack, job.counter)
      return
    end
    if not more then
      return done(job, nil, errors)
    end
    job.k = job.k + 1
  end
end

-- A craft layout that does not fit (or cannot be routed) as it is, is tried turned and mirrored: rows
-- flow east and stack downwards, so a tall, narrow area may fit them turned, and belts route more easily
-- when the rows flow from the inputs towards the output. The result is turned back at the end.
solve.TURNS = transform.ALL

-- the turns in the order they are tried: the layout as it is first, then those where the output lies
-- furthest east of the inputs (the way rows flow); ties keep the order of solve.TURNS
function solve.turn_order(raw)
  local scored = {}
  for i, name in ipairs(solve.TURNS) do
    local p = name == "identity" and raw or transform.problem(raw, name)
    local dx = 0
    local ok = type(p.output) == "table" and type(p.output.position) == "table" and type(p.inputs) == "table"
    if ok then
      local sum, n = 0, 0
      for _, inp in ipairs(p.inputs) do
        if type(inp) == "table" and type(inp.position) == "table" and type(inp.position.x) == "number" then
          sum, n = sum + inp.position.x, n + 1
        end
      end
      if n > 0 and type(p.output.position.x) == "number" then
        dx = p.output.position.x - sum / n
      end
    end
    scored[i] = { name = name, dx = dx, i = i }
  end
  table.sort(scored, function(a, b)
    if (a.name == "identity") ~= (b.name == "identity") then
      return a.name == "identity"
    end
    if a.dx ~= b.dx then
      return a.dx > b.dx
    end
    return a.i < b.i
  end)
  local order = {}
  for i, s in ipairs(scored) do
    order[i] = s.name
  end
  return order
end

-- Two rounds: first every turn may spend solve.TURN_TRIAL search steps (the best turn often routes in a
-- few thousand while another needs a hundred thousand), then the turns that ran out of steps try again,
-- in order, with what is left of the job's budget (routing.MAX_TOTAL_EXPANSIONS).
solve.TURN_TRIAL = 8000

--- M12: how many parallel chains a craft layout gets: 2 when that raises "max", or when a target is
--- more than one chain's lanes carry (and two carry it); else 1. Several products: 1. max_lanes = 1
--- (the problem's "max_lanes", setting "Max fills: one lane"): "max" stays on one chain.
function solve.copies_for(p, pack, max_lanes, max_chains)
  if p.outputs and #p.outputs > 1 then
    return 1
  end
  if p.output.rate_max and max_lanes == 1 then
    return 1
  end
  local saved = p.output.rate
  p.output.rate = fraction.new(1)
  local unit = ratios.solve(p, pack)
  p.output.rate = saved
  if not unit then
    return 1
  end
  -- chain 2 side-loads onto the output port from its left: that tile must be in the area
  local o = p.output
  local lv = direction.vector((o.direction + 12) % 16)
  local lx, ly = math.floor(o.position.x) + lv.x, math.floor(o.position.y) + lv.y
  local a = p.area
  if lx < a[1][1] or ly < a[1][2] or lx >= a[2][1] or ly >= a[2][2] then
    return 1
  end
  -- three or more chains need a collector belt behind the output port: its tiles in the area
  local most = math.min(2, max_chains or 2)
  local v = direction.vector(o.direction)
  for k = 3, math.min(solve.MAX_CHAINS, max_chains or solve.MAX_CHAINS) do
    local ok = true
    for i = 1, math.ceil(k / 2) do
      local cx, cy = math.floor(o.position.x) - v.x * i, math.floor(o.position.y) - v.y * i
      ok = ok and cx >= a[1][1] and cy >= a[1][2] and cx < a[2][1] and cy < a[2][2]
    end
    if not ok then
      break
    end
    most = k
  end
  -- the fewest chains that give the most (for "max"), or that carry the target
  local best_k, best = 1, rows.max_rate(unit, p, pack, 1)
  for k = 2, most do
    local r = rows.max_rate(unit, p, pack, k)
    if p.output.rate_max then
      if r > best then
        best_k, best = k, r
      end
    elseif best < p.output.rate and r >= p.output.rate then
      return k
    end
  end
  if p.output.rate_max then
    return best_k
  end
  return 1
end

solve.MAX_CHAINS = 6 -- M12: parallel chains at most

--- The routing budget of a job: routing.MAX_TOTAL_EXPANSIONS for areas up to 50 x 50, growing with the
--- area beyond (a 100 x 100 layout gets four times as much).
function solve.budget(job)
  local a = job.raw and job.raw.area
  local cells = 0
  local ok = type(a) == "table" and type(a[1]) == "table" and type(a[2]) == "table"
  for _, v in ipairs(ok and { a[1][1], a[1][2], a[2][1], a[2][2] } or { false }) do
    ok = ok and type(v) == "number"
  end
  if ok then
    cells = math.max(0, (a[2][1] - a[1][1]) * (a[2][2] - a[1][2]))
  end
  return math.floor(routing.MAX_TOTAL_EXPANSIONS * math.max(1, cells / 2500))
end

-- M12: refusals a lower target may get past (setting "Retry with a lower target": raw.retry_lower)
solve.RETRY_LOWER = {
  ["area-too-small"] = true,
  ["ports-in-the-way"] = true,
  ["no-route"] = true,
  ["belt-too-slow"] = true,
  ["supply-split"] = true,
}
solve.LOWEST_SCALE = 64 -- down to 1/64 of the target

-- did a turn fail because the belts did not get through?
local function had_no_route(job)
  for _, errs in pairs(job.errors_of) do
    for _, e in ipairs(errs) do
      if e.code == "no-route" then
        return true
      end
    end
  end
  return false
end

local function retry_lower(errors)
  for _, e in ipairs(errors or {}) do
    if solve.RETRY_LOWER[e.code] then
      return true
    end
  end
  return false
end

-- set up the rows and routing of job.turn (or the next turn that gets that far); when no turn works,
-- the errors reported are those of the layout as it is (identity), as they are about the area as the
-- player sees it (e.g. the size area-too-small asks for)
local function start_craft(job, pack)
  while true do
    while job.turn <= #job.turns and not (job.round == 1 or job.retry[job.turns[job.turn]]) do
      job.turn = job.turn + 1
    end
    if job.turn > #job.turns then
      if job.round == 2 or next(job.retry) == nil then
        if not job.room and not job.wide and had_no_route(job) then
          -- the belts did not get through: once more with a wide corridor west of the rows, where
          -- they take their ingredients (still with two chains, if there are)
          job.wide = true
          job.first_errors = job.first_errors or job.errors_of.identity
          job.round, job.turn, job.retry, job.errors_of = 1, 1, {}, {}
          job.counter = routing.new_counter(solve.budget(job))
        elseif job.copies > 1 then
          -- the chains fit nowhere: once more with one fewer (for "max": at that many chains' rate)
          job.copies, job.round, job.turn, job.retry, job.errors_of = job.copies - 1, 1, 1, {}, {}
          job.counter = routing.new_counter(solve.budget(job)) -- a fresh budget, as the job had before
        elseif
          not job.room
          and job.raw.retry_lower
          and job.scale < solve.LOWEST_SCALE
          and retry_lower(job.errors_of.identity or select(2, next(job.errors_of)))
        then
          -- M12: once more at half the target (each output's)
          job.first_errors = job.first_errors or job.errors_of.identity
          job.scale = job.scale * 2
          job.round, job.turn, job.retry, job.errors_of = 1, 1, {}, {}
          job.counter = routing.new_counter(solve.budget(job))
        else
          break
        end
      else
        job.round, job.turn = 2, 1
      end
    else
      local name = job.turns[job.turn]
      job.counter.limit = job.round == 1 and job.counter.spent + solve.TURN_TRIAL or nil
      local p, errors = job.p, nil
      if name ~= "identity" then
        p, errors = problem_mod.load(transform.problem(job.raw, name), pack)
      end
      local plan, layout, nets
      if p then
        p.pole_room = job.room or nil -- M11: rows leave room for poles (tiers.pole)
        p.west_room = job.wide or nil -- a wide corridor west of the rows
      end
      if p and p.output.rate_max then
        -- plan for 1 item/s, then scale to the most the belts carry
        p.output.rate = fraction.new(1)
        local unit
        unit, errors = ratios.solve(p, pack)
        if unit then
          local most, why = rows.max_rate(unit, p, pack, job.copies)
          p.output.rate = most / job.scale
          job.limit = why
        else
          p = nil
        end
      elseif p and job.scale > 1 then
        for i, o in ipairs(p.outputs or { p.output }) do
          o.rate = job.rates0[i] / job.scale
        end
      end
      if p then
        plan, errors = ratios.solve(p, pack)
      end
      if plan then
        if job.copies > 1 then
          plan = rows.split(plan, job.copies)
        end
        layout, errors = rows.place(plan, p, pack)
      end
      local base = {}
      if layout and p then
        for _, e in ipairs(layout.entities) do
          base[#base + 1] = e
        end
        for _, inp in ipairs(p.inputs) do
          base[#base + 1] = port_entity(blueprint.INPUT_PORT, inp)
        end
        for _, o in ipairs(p.outputs or { p.output }) do
          base[#base + 1] = port_entity(blueprint.OUTPUT_PORT, o)
        end
        local splitters
        nets, errors, splitters = routing.nets(layout, p, pack, base)
        for _, e in ipairs(splitters or {}) do
          base[#base + 1] = e
        end
      end
      if nets then
        job.pt, job.base, job.plan, job.layout = p, base, plan, layout
        job.route = routing.route_new(nets, base, p, pack, job.counter)
        return
      end
      job.errors_of[name] = errors
      job.turn = job.turn + 1
    end
  end
  -- M11: room for poles did not fit: the layout without it, as found first
  if job.first_result then
    return done(job, job.first_result, {})
  end
  -- after retries at lower targets: the refusal of the target as asked
  done(job, nil, job.first_errors or job.errors_of.identity)
end

-- M9f: the turn that makes the output face east (mining lines flow that way)
local FACE_EAST = {
  [direction.NORTH] = "rot90",
  [direction.EAST] = "identity",
  [direction.SOUTH] = "rot270",
  [direction.WEST] = "rot180",
}

local function start_mine(job, pack)
  local name = FACE_EAST[job.p.output.direction]
  job.turn, job.turns = 1, { name }
  local p = job.p
  if name ~= "identity" then
    local errors
    p, errors = problem_mod.load(transform.problem(job.raw, name), pack)
    if not p then
      return done(job, nil, errors)
    end
  end
  local placed, errors = mine.place(p, pack)
  if not placed then
    return done(job, nil, errors)
  end
  local base = {}
  for _, e in ipairs(placed.entities) do
    base[#base + 1] = e
  end
  base[#base + 1] = port_entity(blueprint.OUTPUT_PORT, p.output)
  placed.net.goals[1].dirs = routing.into_port(p.output)
  if p.output.rate_max then
    p.output.rate = placed.rate
    job.p.output.rate = placed.rate
  end
  job.pt, job.base = p, base
  job.plan = { steps = {}, inputs = {}, warnings = {}, drills = placed.drills }
  job.layout = { rows = {}, entities = placed.entities }
  job.route = routing.route_new({ placed.net }, base, p, pack, job.counter)
end

local function start(job, pack)
  job.counter = routing.new_counter(solve.budget(job))
  local p, errors = problem_mod.load(job.raw, pack)
  if not p then
    return done(job, nil, errors)
  end
  job.p = p
  job.phase = "route"
  if p.kind == "transport" then
    job.k = 1
    return start_transport_attempt(job, pack)
  elseif p.kind == "mine" then
    return start_mine(job, pack)
  end
  job.turn, job.turns, job.errors_of = 1, solve.turn_order(job.raw), {}
  job.round, job.retry = 1, {}
  -- max_chains (optional, problem files): at most that many chains (the search for more can be long)
  job.copies = solve.copies_for(p, pack, job.raw.max_lanes, job.raw.max_chains)
  job.scale, job.rates0 = 1, {}
  for i, o in ipairs(p.outputs or { p.output }) do
    job.rates0[i] = o.rate
  end
  return start_craft(job, pack)
end

function solve.job_step(job, pack, budget)
  if job.done then
    return 0
  end
  if job.phase == "start" then
    start(job, pack)
    if job.done then
      return 0
    end
  end
  local used = routing.route_step(job.route, pack, budget)
  local st = job.route
  if st.done then
    local p = job.p
    if st.result then
      local plan, layout = job.plan, job.layout
      local base, routed = job.base, st.result
      if p.kind == "transport" then
        plan, layout = transport_plan(p)
      elseif job.turns[job.turn] ~= "identity" then
        -- solved turned: turn the layout back into the area as the player sees it
        local back = transform.INVERSE[job.turns[job.turn]]
        base = transform.entities(base, job.pt.area, back)
        routed = transform.entities(routed, job.pt.area, back)
        -- the rates the turned copy was solved at ("max" worked out, or a lower target)
        local solved = job.pt.outputs or { job.pt.output }
        for i, o in ipairs(p.outputs or { p.output }) do
          o.rate = solved[i].rate
        end
      end
      local result, finish_errors = solve.finish(p, pack, base, routed, plan, layout)
      if result and job.pt then -- craft and mining layouts (transport has no turned copy)
        result.limit = job.pt.output and job.pt.output.rate_max and job.limit or nil -- what sets "max"
        result.scale = job.scale and job.scale > 1 and job.scale or nil -- built at 1/scale of the target
        if result.scale and p.outputs then
          result.rates = {}
          for i, o in ipairs(job.pt.outputs) do
            result.rates[i] = o.rate
          end
        end
      end
      -- M11: power poles (tiers.poles); a layout with machines no pole can reach is solved once more
      -- with room for poles in its rows (tiers.pole), and the better of the two is kept
      if result and p.tiers.poles and #p.tiers.poles > 0 then
        local blocked = {}
        for _, t in ipairs(p.obstacles or {}) do
          blocked[t.x .. "," .. t.y] = true
        end
        result.power = power.cover(
          result.blueprint.blueprint.entities,
          pack,
          { area = p.area, blocked = blocked, poles = p.tiers.poles }
        )
        if result.power.unpowered > 0 and p.tiers.pole and p.kind ~= "mine" and not job.room then
          job.first_result, job.room = result, true
          job.round, job.turn, job.retry, job.errors_of = 1, 1, {}, {}
          job.counter = routing.new_counter(solve.budget(job))
          start_craft(job, pack)
          return used
        end
        if job.first_result and result.power.unpowered > job.first_result.power.unpowered then
          result = job.first_result
        end
      end
      done(job, result, finish_errors)
    elseif p.kind == "mine" then
      done(job, nil, st.errors)
    elseif p.kind == "transport" then
      local _, _, more = transport(p, job.k)
      if more then
        job.k = job.k + 1
        start_transport_attempt(job, pack)
      else
        done(job, nil, st.errors)
      end
    else
      local name = job.turns[job.turn]
      job.errors_of[name] = st.errors
      if job.round == 1 and routing.over_limit(job.counter) then
        job.retry[name] = true -- it ran out of steps: once more in the second round
      end
      job.turn = job.turn + 1
      start_craft(job, pack)
    end
  end
  return used
end

--- Solve at once: one job, stepped to the end.
function solve.run(raw_problem, pack)
  local job = solve.job_new(raw_problem)
  while not job.done do
    solve.job_step(job, pack, math.huge)
  end
  return job.result, job.errors or {}
end

--- M9e: solve a problem with only an output ("auto_inputs": true): the candidates of engine/auto.lua
--- in order, until one fits and routes. The result also has `area` (the candidate's) and `auto_inputs`
--- (the input items).
function solve.run_auto(raw_problem, pack)
  local found, errors = auto.candidates(raw_problem, pack)
  if not found then
    return nil, errors
  end
  for _, c in ipairs(found.candidates) do
    local result
    result, errors = solve.run(c, pack)
    if result then
      result.area, result.auto_inputs, result.problem = c.area, found.items, c
      return result, {}
    end
    local retry = false
    for _, e in ipairs(errors) do
      retry = retry or auto.RETRY[e.code] or false
    end
    if not retry then
      return nil, errors
    end
  end
  return nil, errors
end

--- Number the entities, validate, and package the result.
function solve.finish(p, pack, base, routed, plan, layout)
  local entities = {}
  for _, list in ipairs({ base, routed }) do
    for _, e in ipairs(list) do
      local copy = {}
      for k, v in pairs(e) do
        copy[k] = v
      end
      copy.entity_number = #entities + 1
      entities[#entities + 1] = copy
    end
  end
  local bp = {
    blueprint = {
      item = "blueprint",
      label = p.kind == "transport" and ("Interpose: transport " .. #p.outputs .. " items")
        or p.kind == "mine" and ("Interpose: mining " .. p.output.item .. " " .. tostring(p.output.rate) .. "/s")
        or #p.outputs > 1 and ("Interpose: " .. #p.outputs .. " products")
        or ("Interpose: " .. p.output.item .. " " .. tostring(p.output.rate) .. "/s"),
      entities = entities,
    },
  }
  local resources
  if #(p.resources or {}) > 0 then
    resources = {}
    for _, t in ipairs(p.resources) do
      resources[t.x .. "," .. t.y] = t.name
    end
  end
  local report = validate.run(bp, pack, { area = p.area, resources = resources })
  -- nothing may stand on an obstacle (a bug if it does, like a layout that does not validate)
  if report.ok and #(p.obstacles or {}) > 0 then
    local blocked = {}
    for _, t in ipairs(p.obstacles) do
      blocked[t.x .. "," .. t.y] = true
    end
    for _, e in ipairs(blueprint.load(bp.blueprint, pack).entities) do
      for _, t in ipairs(e.tiles) do
        if blocked[t[1] .. "," .. t[2]] then
          return nil,
            {
              issues.new(
                "internal",
                string.format("the generated layout puts %s on an obstacle at %d, %d", e.name, t[1], t[2]),
                "please report this, with the problem file"
              ),
            }
        end
      end
    end
  end
  if not report.ok then
    -- the solver produced something its own validator rejects: a bug, not the player's fault
    local first = report.errors[1]
    return nil,
      {
        issues.new(
          "internal",
          "the generated layout does not validate: " .. first.code .. ": " .. first.message,
          "please report this, with the problem file"
        ),
      }
  end
  return {
    blueprint = bp,
    report = report,
    plan = plan,
    layout = layout,
    warnings = plan.warnings,
    rate = p.output and p.output.rate, -- items per second; worked out when the problem said "max"
    rate_max = p.output and p.output.rate_max or nil,
  }, {}
end

return solve
