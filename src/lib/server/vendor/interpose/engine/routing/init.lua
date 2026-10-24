--- Stage 4 (F4b): belt routing. Connects every net with belts and underground belts, using A* on
--- the tile grid. Nets:
---   input port        -> the row that uses its item
---   row output belt   -> the row that uses its result
---   last row's output -> the output port
--- A row with two ingredients takes one from behind (its input belt's west end) and one side-loaded
--- from above, so each lane carries one item. Items from another row's output go in from behind.
---
--- Rules that keep the routes from mixing items:
---   * a new belt never goes on a tile that an existing belt, underground exit or port points into
---     (except the net's own start tile), so nothing leaks onto it;
---   * a new belt only points into the next tile of its own route, or into the net's target;
---   * an underground may pass under anything except an underground of the same type on that line.
--- If a net cannot be routed, other net orders are tried (rip-up and reroute, bounded).
local blueprint = require("engine.blueprint")
local direction = require("engine.model.direction")
local heap = require("engine.model.heap")
local issues = require("engine.issues")
local fan = require("engine.placement.fan")

local routing = {}

-- Work limits, in search steps. Measured: 7,000-25,000 steps per second (slower in big areas); the
-- golden case needs ~500 steps, the hardest test case (5 shuffled lines) ~26,000. The total covers one
-- whole job (every attempt of one drag or CLI run), so the worst case is a pause of seconds, not minutes.
routing.MAX_EXPANSIONS = 50000 -- per route search
routing.MAX_TOTAL_EXPANSIONS = 100000 -- for one job, see routing.new_counter

--- A work counter for one job (every attempt of one drag or CLI run); routing.route_new takes one.
--- A search stops when spent passes limit (routing.MAX_TOTAL_EXPANSIONS unless the job lowers it for
--- one attempt).
--- max (optional): the job's own budget instead of routing.MAX_TOTAL_EXPANSIONS (solve scales it with
--- the area: a 100 x 100 layout with several chains needs a few times more).
function routing.new_counter(max)
  return { spent = 0, max = max }
end

local function over_limit(counter)
  local max = counter.max or routing.MAX_TOTAL_EXPANSIONS
  return counter.spent > math.min(counter.limit or max, max)
end
routing.over_limit = over_limit
routing.COST = { belt = 1, turn = 0.5, underground = 10, underground_per_tile = 0.5 }

local DIRS = { direction.NORTH, direction.EAST, direction.SOUTH, direction.WEST }

-- tile and search-state keys are numbers (no string building in the search loop): exact for tile
-- coordinates within +-2^21 (a Factorio map is at most +-1,000,000 tiles)
local OFFSET, SPAN = 2097152, 4194304

local function key(x, y)
  return (x + OFFSET) * SPAN + (y + OFFSET)
end

local function state_key(x, y, d)
  return key(x, y) * 4 + d / 4
end

local function left(d)
  return (d + 12) % 16
end

local function right(d)
  return (d + 4) % 16
end

--- Occupancy and "fed" tiles from a list of blueprint entities and obstacle tiles ({x, y}; nothing is
--- built there, undergrounds pass under). Plain data only (no pack tables), so a job's world can be
--- kept in the game's storage.
local function build_world(entities, pack, obstacles)
  local numbered = {}
  for i, e in ipairs(entities) do
    local copy = {}
    for k, v in pairs(e) do
      copy[k] = v
    end
    copy.entity_number = i
    numbered[i] = copy
  end
  local model = blueprint.load({ entities = numbered }, pack)
  local occupied, fed, undergrounds = {}, {}, {}
  for _, t in ipairs(obstacles or {}) do
    occupied[key(t.x, t.y)] = { name = "obstacle" }
  end
  for _, e in ipairs(model.entities) do
    for _, t in ipairs(e.tiles) do
      occupied[key(t[1], t[2])] = { name = e.name }
    end
    local v = direction.vector(e.dir)
    -- ports are belts: both push items forward (an output port out of the area)
    local port = e.kind == "input_port" or e.kind == "output_port"
    local feeder = { name = e.name, tx = e.tx, ty = e.ty }
    if e.kind == "belt" or port or (e.kind == "underground" and e.io == "output") then
      fed[key(e.tx + v.x, e.ty + v.y)] = feeder
    elseif e.kind == "splitter" then
      for _, t in ipairs(e.tiles) do
        fed[key(t[1] + v.x, t[2] + v.y)] = feeder
      end
    end
    if e.kind == "underground" then
      undergrounds[key(e.tx, e.ty)] = { name = e.name, dir = e.dir }
    end
  end
  return { occupied = occupied, fed = fed, undergrounds = undergrounds, tunnels = {} }
end

local function add_to_world(world, placed, ug_name)
  local entrance
  world.tunnels = world.tunnels or {}
  for _, p in ipairs(placed) do
    world.occupied[key(p.x, p.y)] = { name = p.name }
    if p.kind == "belt" or p.kind == "underground-output" then
      local v = direction.vector(p.dir)
      world.fed[key(p.x + v.x, p.y + v.y)] = { name = p.name }
    end
    if p.kind ~= "belt" then
      world.undergrounds[key(p.x, p.y)] = { name = ug_name, dir = p.dir }
    end
    -- #23: the tiles between a pair's ends, per axis: another underground of the same type may not
    -- stand there (the game would pair it with one of these ends)
    if p.kind == "underground-input" then
      entrance = p
    elseif p.kind == "underground-output" and entrance then
      local dx = (p.x > entrance.x and 1) or (p.x < entrance.x and -1) or 0
      local dy = (p.y > entrance.y and 1) or (p.y < entrance.y and -1) or 0
      local x, y = entrance.x + dx, entrance.y + dy
      while x ~= p.x or y ~= p.y do
        local k = key(x, y)
        world.tunnels[k] = world.tunnels[k] or {}
        world.tunnels[k][p.dir % 8] = ug_name
        x, y = x + dx, y + dy
      end
      entrance = nil
    end
  end
end

-- extra cost of a tile / tunnel used by other nets (negotiated congestion); plain data, see negotiate
local function soft_tile(soft, nets_count, x, y)
  local k = key(x, y)
  if soft.tiles[k] then return soft.tiles[k] end
  local c = soft.history[k] or 0
  for j = 1, nets_count do
    local u = soft.usage[j]
    if u and j ~= soft.net and (u.tiles[k] or u.fed[k]) then
      c = c + soft.present
    end
  end
  soft.tiles[k]=c
  return c
end

local function soft_tunnel(soft, nets_count, x, y, axis)
  local k = key(x, y)
  local cached=soft.tunnels[k]
  if cached and cached[axis] then return cached[axis] end
  local c = 0
  for j = 1, nets_count do
    local u = soft.usage[j]
    if u and j ~= soft.net and u.tunnels[k] == axis then
      c = c + soft.present
    end
  end
  soft.tunnels[k]=cached or {};soft.tunnels[k][axis]=c
  return c
end

--- A* for one net, in steps. start = {x, y, dir}: items arrive on tile (x, y) moving dir.
--- goals: list of {x, y, dirs = {[dir] = true}}: the net is done when items arrive on a goal tile
--- moving in one of its dirs. search_new makes the search's state (plain data); search_step runs up to
--- `budget` steps of it and returns the steps used. When s.done, s.result is the list of placements,
--- or nil when there is no route (or the work limit was hit).
function routing.search_new(start, goals)
  local s = { start = start, goals = goals, open = heap.new(), best_g = {}, expansions = 0 }
  for _, g in ipairs(goals) do
    if g.x == start.x and g.y == start.y and g.dirs[start.dir] then
      s.done, s.result = true, {}
      return s
    end
  end
  local h = math.huge
  for _, g in ipairs(goals) do
    h = math.min(h, math.abs(g.x - start.x) + math.abs(g.y - start.y))
  end
  s.open:push(h, { x = start.x, y = start.y, dir = start.dir, g = 0 })
  s.best_g[state_key(start.x, start.y, start.dir)] = 0
  return s
end

function routing.search_step(s, world, area, opts, counter, budget)
  local start, goals = s.start, s.goals
  local goal_at = s.goal_at or {}
  for _, g in ipairs(s.goal_at and {} or goals) do
    local k=key(g.x,g.y)
    local target=goal_at[k] or {dirs={}};goal_at[k]=target
    for d,allowed in pairs(g.dirs) do if allowed then target.dirs[d]=true end end
  end
  s.goal_at=goal_at
  s.distances=s.distances or {}
  local function is_goal(x, y, d)
    local g = goal_at[key(x, y)]
    return g and g.dirs[d]
  end
  local function h(x, y)
    local k=key(x,y)
    if s.distances[k] then return s.distances[k] end
    local best = math.huge
    for _, g in ipairs(goals) do
      best = math.min(best, math.abs(g.x - x) + math.abs(g.y - y))
    end
    s.distances[k]=best
    return best
  end
  local function inside(x, y)
    return x >= area[1][1] and y >= area[1][2] and x < area[2][1] and y < area[2][2]
  end
  local start_key = key(start.x, start.y)
  -- the start tile is fed by the net's own source; anything else feeding it would mix in
  local feeder = world.fed[start_key]
  local start_ok = not feeder or (feeder.tx == start.from_x and feeder.ty == start.from_y)
  -- does the route ending in `node` already use tile (x, y)? Its tiles are marked once per node (a
  -- step asks up to 5 times), with a stamp instead of clearing the marks
  local mark, stamp, marked_for = {}, 0, nil
  local function on_path(node, x, y)
    if marked_for ~= node then
      stamp, marked_for = stamp + 1, node
      local n = node
      while n do
        local placed = n.placed
        if placed then
          for i = 1, #placed do
            mark[placed[i].k] = stamp
          end
        end
        n = n.parent
      end
    end
    return mark[key(x, y)] == stamp
  end
  -- the cheap checks first, the walk along the route last
  local function placeable(x, y, node)
    if not inside(x, y) then
      return false
    end
    local k = key(x, y)
    if world.occupied[k] then
      return false
    end
    if k == start_key then
      return start_ok and not on_path(node, x, y)
    end
    -- tiles another net needs to reach its target are kept free for it
    local owner = opts.reserved and opts.reserved[k]
    if (owner and owner ~= opts.net) or world.fed[k] then
      return false
    end
    return not on_path(node, x, y)
  end
  local soft, nets_count = opts.soft, opts.nets_count
  if soft then
    s.soft_tiles=s.soft_tiles or {};s.soft_tunnels=s.soft_tunnels or {}
    soft.tiles,soft.tunnels=s.soft_tiles,s.soft_tunnels
  end

  local open, best_g = s.open, s.best_g
  local used = 0
  while used < budget do
    local node = not open:empty() and open:pop() or nil
    if not node then
      s.done, s.result = true, nil
      return used
    end
    used = used + 1
    s.expansions = s.expansions + 1
    counter.spent = counter.spent + 1
    if s.expansions > (opts.max_expansions or routing.MAX_EXPANSIONS) or over_limit(counter) then
      s.done, s.result = true, nil
      return used
    end
    if node.goal then
      -- the cheapest route to a goal: collect its placements from the root
      local placed = {}
      local n = node
      while n do
        for i = #(n.placed or {}), 1, -1 do
          table.insert(placed, 1, n.placed[i])
        end
        n = n.parent
      end
      s.done, s.result = true, placed
      s.open, s.best_g = nil, nil -- let the search's memory go
      return used
    end
    if node.g==best_g[state_key(node.x,node.y,node.dir)] and placeable(node.x, node.y, node) then
      local node_k = key(node.x, node.y)
      local successors = {}
      -- a belt on this tile, straight or turning
      local here = soft and soft_tile(soft, nets_count, node.x, node.y) or 0
      for _, d2 in ipairs({ node.dir, left(node.dir), right(node.dir) }) do
        local v = direction.vector(d2)
        local cost = routing.COST.belt + (d2 ~= node.dir and routing.COST.turn or 0) + here
        successors[#successors + 1] = {
          x = node.x + v.x,
          y = node.y + v.y,
          dir = d2,
          cost = cost,
          placed = { { kind = "belt", x = node.x, y = node.y, dir = d2, k = node_k } },
        }
      end
      -- an underground pair: entrance here, exit k tiles ahead
      -- going outwards, so the tiles passed under are checked (and their congestion summed) once each;
      -- congestion costs are exact binary fractions, so the summing order does not change a result
      local v = direction.vector(node.dir)
      local back = direction.opposite(node.dir)
      local axis = node.dir % 8
      local under = 0 -- congestion of the tiles passed under so far
      -- #23: no end of a new pair inside another pair's tunnel of the same type on this axis
      local function in_tunnel(x, y)
        local t = world.tunnels and world.tunnels[key(x, y)]
        return t and t[axis] == opts.underground
      end
      for k = 2, in_tunnel(node.x, node.y) and 0 or opts.max_distance do
        local mx, my = node.x + v.x * (k - 1), node.y + v.y * (k - 1)
        local u = world.undergrounds[key(mx, my)]
        if u and u.name == opts.underground and (u.dir == node.dir or u.dir == back) then
          break -- an underground of the same type on this line: no longer tunnel passes it either
        end
        if soft then
          under = under + soft_tunnel(soft, nets_count, mx, my, axis)
        end
        local ex, ey = node.x + v.x * k, node.y + v.y * k
        if placeable(ex, ey, node) and not in_tunnel(ex, ey) then
          local extra = 0
          if soft then
            extra = here + soft_tile(soft, nets_count, ex, ey)
            extra = extra
              + soft_tunnel(soft, nets_count, node.x, node.y, axis)
              + soft_tunnel(soft, nets_count, ex, ey, axis)
            extra = extra + under
          end
          successors[#successors + 1] = {
            x = ex + v.x,
            y = ey + v.y,
            dir = node.dir,
            cost = routing.COST.underground + routing.COST.underground_per_tile * k + extra,
            placed = {
              { kind = "underground-input", x = node.x, y = node.y, dir = node.dir, k = node_k },
              { kind = "underground-output", x = ex, y = ey, dir = node.dir, k = key(ex, ey) },
            },
          }
        end
      end
      for _, sc in ipairs(successors) do
        local child = { x = sc.x, y = sc.y, dir = sc.dir, g = node.g + sc.cost, parent = node, placed = sc.placed }
        -- a goal is only accepted when popped, so the cheapest route wins
        child.goal = is_goal(sc.x, sc.y, sc.dir) or nil
        local sk = state_key(sc.x, sc.y, sc.dir)
        if not best_g[sk] or child.g < best_g[sk] then
          best_g[sk] = child.g
          open:push(child.g + h(sc.x, sc.y)*(opts.heuristic_weight or 1), child)
        end
      end
    end
  end
  return used
end

--- Goal directions for an output port: it is a belt, so items may arrive from behind or from either
--- side, never head-on.
function routing.into_port(port)
  local dirs = {}
  local head_on = direction.opposite(port.direction or direction.NORTH)
  for _, d in ipairs(DIRS) do
    dirs[d] = d ~= head_on or nil
  end
  return dirs
end

--- Build the list of nets from a placed layout (engine/placement/rows), a loaded problem and the
--- entities already placed (rows and ports). A supply that several rows use gets a fan of splitters
--- (engine/placement/fan) where its items arrive; each fan output is a net of its own.
--- Returns nets, errors, splitters (blueprint entities to add to the placed ones), or nil, errors.
function routing.nets(layout, problem, pack, base)
  local errors = {}
  local sources = {} -- item -> {x, y, dir, label}
  for _, inp in ipairs(problem.inputs) do
    local v = direction.vector(inp.direction)
    local tx, ty = math.floor(inp.position.x), math.floor(inp.position.y)
    sources[inp.item] =
      { x = tx + v.x, y = ty + v.y, dir = inp.direction, from_x = tx, from_y = ty, label = "input port " .. inp.item }
  end
  -- M12: with parallel chains, an item a row makes comes from that chain's row (key item#copy)
  local function key_of(item, copy)
    return copy and (item .. "#" .. copy) or item
  end
  local from_row = {}
  local product_sources = {} -- item -> keys of the rows that make it, in order
  for _, row in ipairs(layout.rows) do
    local ob = row.output_belt
    if ob then
    local k = key_of(row.item, row.copy)
    local label = "row " .. row.recipe .. (row.copy and (" (chain " .. row.copy .. ")") or "")
    local d=ob.direction or direction.EAST
    local v=direction.vector(d)
    sources[k] = { x = ob.x2 + v.x, y = ob.y + v.y, dir = d, from_x = ob.x2, from_y = ob.y, label = label,rate=row.product_rate }
    from_row[row.item] = true
    product_sources[row.item] = product_sources[row.item] or {}
    table.insert(product_sources[row.item], k)
    end
  end
  for item,port in pairs(problem.item_headers or {}) do
    local v=direction.vector(port.direction)
    sources[item]={x=math.floor(port.position.x)+v.x,y=math.floor(port.position.y)+v.y,dir=port.direction,label="header "..item}
  end

  for name,source in pairs(problem.link_sources or {}) do sources[name]=source end

  -- every place an item must go, in a fixed order
  local demands, items, by_item = {}, {}, {}
  -- src: the source's key (an item, or item#copy for a chain's own row)
  local function demand(src, item, sink_label, goals, reserve, port, priority, bootstrap_rate, perMinute)
    if not by_item[src] then
      by_item[src] = {}
      items[#items + 1] = src
    end
    local d = { item = item, sink = sink_label, goals = goals, reserve = reserve, port = port, priority=priority, bootstrap_rate=bootstrap_rate, perMinute=perMinute }
    demands[#demands + 1] = d
    table.insert(by_item[src], d)
  end
  -- where a row of chain `copy` gets an item: its own chain's row, or the shared input port
  local function source_key(item, row)
    if row.source_keys and row.source_keys[item] then return row.source_keys[item] end
    local copy=row.copy
    if problem.item_headers and problem.item_headers[item] then return item end
    local k = key_of(item, copy)
    return sources[k] and k or item
  end
  local base_world
  local function consume(row,item,label,goals,reserve)
    if row.supplies and row.supplies[item] then
      for _,route in ipairs(row.supplies[item]) do
        base_world=base_world or build_world(base,pack,problem.obstacles)
        local approaches={}
        for _,goal in ipairs(route.goals) do for d in pairs(goal.dirs) do
          local v=direction.vector(d);local x,y=goal.x-v.x,goal.y-v.y
          if not base_world.occupied[key(x,y)] and x>=problem.area[1][1] and x<problem.area[2][1] and y>=problem.area[1][2] and y<problem.area[2][2] then approaches[key(x,y)]={x=x,y=y} end
        end end
        local critical={};for _,tile in pairs(approaches) do critical[#critical+1]=tile end
        demand(route.source,item,label,route.goals,#critical==1 and critical or {},false,route.priority,route.bootstrap_rate)
      end
    else demand(source_key(item,row),item,label,goals,reserve,false,nil,nil,row.ingredient_rates and row.ingredient_rates[item]) end
  end
  for _, row in ipairs(layout.rows) do
    local ib = row.input_belt
    local ings = {}
    for i, item in ipairs(row.inner or row.ingredients) do
      ings[i] = item
    end
    -- an ingredient made by another row comes in from behind (it is on one lane already)
    table.sort(ings, function(a, b)
      if (from_row[a] or false) ~= (from_row[b] or false) then
        return from_row[a] or false
      end
      return a < b
    end)
    for i, item in ipairs(ings) do
      if not (row.supplies and row.supplies[item]) and not sources[source_key(item, row)] then
        errors[#errors + 1] = issues.new(
          "missing-input",
          "nothing supplies " .. item .. " for row " .. row.recipe,
          "add an input port for " .. item
        )
      else
        local goals
        local reserve = {}
        if row.merge then
          -- two ingredients that each fill both lanes: both are side-loaded onto the belt's first
          -- tile, one from each side, so each gets one lane (nothing comes from behind)
          local d = i == 1 and direction.SOUTH or direction.NORTH
          local v = direction.vector(d)
          goals = { { x = ib.x1, y = ib.y, dirs = { [d] = true } } }
          reserve = { { x = ib.x1 - v.x, y = ib.y - v.y } }
        elseif i == 1 then
          goals = { { x = ib.x1, y = ib.y, dirs = { [direction.EAST] = true } } }
          reserve = { { x = ib.x1 - 1, y = ib.y } }
        else
          -- side-load above the first machine, upstream of at least one of its input inserters
          goals = {}
          for x = ib.x1, row.last_first_machine_inserter_x do
            goals[#goals + 1] = { x = x, y = ib.y, dirs = { [direction.SOUTH] = true } }
            reserve[#reserve + 1] = { x = x, y = ib.y - 1 }
          end
        end
        consume(row,item,"row " .. row.recipe,goals,reserve)
      end
    end
    -- a second (outer) input belt: one ingredient from behind, maybe one side-loaded from above,
    -- upstream of at least one long-handed inserter of the first machine
    local ob = row.outer_belt
    if ob then
      for _, item in ipairs({ row.outer_behind, row.outer_side or false }) do
        if item and not (row.supplies and row.supplies[item]) and not sources[source_key(item, row)] then
          errors[#errors + 1] = issues.new(
            "missing-input",
            "nothing supplies " .. item .. " for row " .. row.recipe,
            "add an input port for " .. item
          )
        elseif item == row.outer_behind then
          consume(
            row,
            item,
            "row " .. row.recipe .. " (outer belt)",
            { { x = ob.x1, y = ob.y, dirs = { [direction.EAST] = true } } },
            { { x = ob.x1 - 1, y = ob.y } }
          )
        elseif item then
          local goals, reserve = {}, {}
          for x = ob.x1, row.last_first_machine_long_x do
            goals[#goals + 1] = { x = x, y = ob.y, dirs = { [direction.SOUTH] = true } }
            reserve[#reserve + 1] = { x = x, y = ob.y - 1 }
          end
          consume(row,item,"row " .. row.recipe .. " (outer belt)",goals,reserve)
        end
      end
    end
  end
  local collector = {} -- M12: belts that join three or more chains in front of the output port
  for _, out in ipairs(problem.outputs or { problem.output }) do
    local keys = out.sources or product_sources[out.item] or (sources[out.item] and { out.item }) or {}
    if #keys == 0 then
      errors[#errors + 1] = issues.new("internal", "no row makes the output item " .. out.item, "please report this")
    elseif out.merge_lane then
      -- All producers side-load the same lane before it becomes an ingredient.
      -- Keeping both lanes here could contaminate a later mixed-item belt.
      for j,source in ipairs(keys) do
        local goal={x=math.floor(out.position.x)+j-1,y=math.floor(out.position.y),dirs={[direction.NORTH]=true}}
        demand(source,out.item,'the merge for '..out.item,{goal},{},false,out.source_priority[source],out.bootstrap_rate)
      end
    elseif #keys == 1 then
      demand(
        keys[1],
        out.item,
        "the output port " .. out.item,
        { { x = math.floor(out.position.x), y = math.floor(out.position.y), dirs = routing.into_port(out) } },
        {},
        true
      )
    elseif #keys > 2 then
      -- M12: three or more chains: a collector belt runs into the output port from behind; the chains
      -- side-load onto it from both sides (right side: right lane, left side: left lane), two per tile
      local d = out.direction
      local v = direction.vector(d)
      local tx, ty = math.floor(out.position.x), math.floor(out.position.y)
      local branches,counts={}, {0,0}
      local rated=true
      for _,k in ipairs(keys) do if not (out.source_rates and out.source_rates[k] or sources[k].rate) then rated=false end end
      local remaining={pack.belts[problem.tiers.belt].items_per_second*30,pack.belts[problem.tiers.belt].items_per_second*30}
      for j,k in ipairs(keys) do
        local amount=rated and (out.source_rates and out.source_rates[k] or sources[k].rate) or 1
        while amount>1e-6 do
          local side=rated and (remaining[1]>=remaining[2] and 1 or 2) or (j%2==1 and 1 or 2)
          local moved=rated and math.min(amount,remaining[side]) or amount
          assert(moved>1e-6,'Output producer rows exceed the selected belt capacity')
          counts[side]=counts[side]+1
          branches[#branches+1]={source=k,side=side,column=counts[side]}
          remaining[side]=remaining[side]-moved;amount=amount-moved
        end
      end
      local length = math.max(counts[1],counts[2])
      local uses={} for _,branch in ipairs(branches) do uses[branch.source]=(uses[branch.source] or 0)+1 end
      -- Through traffic wins over side-loading. Fully assigned producers go
      -- upstream; a producer split between lanes fills only their remainders.
      for side=1,2 do
        local column=counts[side]
        for _,shared in ipairs{false,true} do for _,branch in ipairs(branches) do
          if branch.side==side and (uses[branch.source]>1)==shared then branch.column=column;column=column-1 end
        end end
      end
      local a = problem.area
      for i = 1, length do
        local cx, cy = tx - v.x * i, ty - v.y * i
        if cx < a[1][1] or cy < a[1][2] or cx >= a[2][1] or cy >= a[2][2] then
          errors[#errors + 1] = issues.new(
            "no-route",
            "no room in front of the output port for the belt that joins " .. #keys .. " chains",
            "make the area larger behind the output port"
          )
          break
        end
        collector[#collector + 1] =
          { name = problem.tiers.belt, position = { x = cx + 0.5, y = cy + 0.5 }, direction = d }
      end
      for j, branch in ipairs(branches) do
        local cx, cy = tx - v.x * branch.column, ty - v.y * branch.column
        local dirs = branch.side == 1 and { [left(d)] = true } or { [right(d)] = true }
        demand(branch.source, out.item, "the collector for " .. out.item .. " (chain " .. j .. ")", {
          { x = cx, y = cy, dirs = dirs },
        }, {}, true)
      end
    else
      -- M12: two chains onto the output port, one lane each. A row's product is on the right lane
      -- of its belt (its inserters drop onto the far lane), so chain 1 comes from behind or side-loads
      -- from the right (both keep it on the right lane), chain 2 side-loads from the left (left lane).
      local tx, ty, d = math.floor(out.position.x), math.floor(out.position.y), out.direction
      local dirs = { { [d] = true, [left(d)] = true }, { [right(d)] = true } }
      for j, k in ipairs(keys) do
        demand(k, out.item, "the output port " .. out.item .. " (chain " .. j .. ")", {
          { x = tx, y = ty, dirs = dirs[j] },
        }, {}, true)
      end
    end
  end
  if #errors > 0 then
    return nil, errors
  end

  -- fans: tiles must be inside the area, empty, fed by nothing, and not a goal or reserved tile
  local with_collector = base
  if #collector > 0 then
    with_collector = {}
    for _, e in ipairs(base) do
      with_collector[#with_collector + 1] = e
    end
    for _, e in ipairs(collector) do
      with_collector[#with_collector + 1] = e
    end
  end
  local world = build_world(with_collector, pack, problem.obstacles)
  local kept = {}
  for _, d in ipairs(demands) do
    for _, list in ipairs({ d.goals, d.reserve }) do
      for _, t in ipairs(list) do
        kept[key(t.x, t.y)] = true
      end
    end
  end
  local a = problem.area
  local splitters = {}
  for _, e in ipairs(collector) do
    splitters[#splitters + 1] = e -- placed with the rows and ports, like the fans' splitters
  end
  local function placer(src)
    return function(x, y)
      local k = key(x, y)
      local fed = world.fed[k]
      return x >= a[1][1]
        and y >= a[1][2]
        and x < a[2][1]
        and y < a[2][2]
        and not world.occupied[k]
        and not kept[k]
        and (not fed or (x == src.x and y == src.y))
    end
  end
  local nets = {}
  local net_of = {}
  for _, item in ipairs(items) do
    local list, src = by_item[item], sources[item]
    if #list == 1 then
      net_of[list[1]] = src
    elseif not problem.tiers.splitter then
      errors[#errors + 1] =
        issues.new("unknown-tier", "no splitter goes with " .. problem.tiers.belt, "add tiers.splitter to the problem")
    else
      -- the fan opens towards the side where most of its users are; users are matched to its outputs
      -- in order across the flow
      local side_u = direction.vector((src.dir + 4) % 16)
      local function across(d)
        local g = d.goals[1]
        return (g.x - src.x) * side_u.x + (g.y - src.y) * side_u.y
      end
      local sum = 0
      for _, d in ipairs(list) do
        sum = sum + across(d)
      end
      local sides = sum >= 0 and { 1, -1 } or { -1, 1 }
      local placed, side
      local to_port = false
      for _, d in ipairs(list) do
        to_port = to_port or d.port or d.priority~=nil or false
      end
      for _, s in ipairs(sides) do
        placed = fan.place(src, #list, s, placer(src), problem.tiers.splitter, to_port or problem.prioritise_inputs and not from_row[list[1].item])
        if placed then
          side = s
          break
        end
      end
      if not placed then
        errors[#errors + 1] = issues.new(
          "supply-split",
          string.format(
            "%s is needed by %d rows, and there is no room for splitters next to %s",
            item,
            #list,
            src.label
          ),
          "make the area larger, or leave free tiles beside the tile in front of the input port"
        )
      else
        local sorted = {}
        for i, d in ipairs(list) do
          sorted[i] = d
        end
        -- an output port goes last: it gets what the rows leave (the splitters prefer the rows)
        table.sort(sorted, function(p, q)
          if (p.port or false) ~= (q.port or false) then
            return q.port or false
          end
          if p.priority and q.priority and p.priority~=q.priority then return p.priority<q.priority end
          local ap, aq = across(p) * side, across(q) * side
          if ap ~= aq then
            return ap < aq
          end
          return p.sink < q.sink
        end)
        for i, d in ipairs(sorted) do
          net_of[d] = placed.outputs[i]
        end
        -- Keep routed outlets fixed; only steer startup toward a recycled feed.
        local bootstrap
        for i,d in ipairs(sorted) do if d.bootstrap_rate and (not bootstrap or d.bootstrap_rate<sorted[bootstrap].bootstrap_rate) then bootstrap=i end end
        -- Keep raw fan routes fixed while giving the largest consumer priority.
        if not bootstrap and not from_row[list[1].item] then
          for i,d in ipairs(sorted) do if d.perMinute and (not bootstrap or d.perMinute>sorted[bootstrap].perMinute) then bootstrap=i end end
        end
        if bootstrap then for j,e in ipairs(placed.entities) do
          local outer=j<bootstrap
          e.output_priority=(side==1)==outer and "right" or "left"
        end end
        for _, e in ipairs(placed.entities) do
          splitters[#splitters + 1] = e
        end
        -- later fans keep clear of this one
        for _, t in ipairs(placed.tiles) do
          kept[key(t[1], t[2])] = true
        end
      end
    end
  end
  if #errors > 0 then
    return nil, errors
  end
  for _, d in ipairs(demands) do
    local src = net_of[d]
    nets[#nets + 1] =
      { item = d.item, from = src, goals = d.goals, reserve = d.reserve, label = src.label .. " -> " .. d.sink }
  end
  return nets, {}, splitters
end

--- Nets for a transport problem: each output port gets its item straight from that item's input port.
function routing.transport_nets(problem)
  local sources = {}
  for _, inp in ipairs(problem.inputs) do
    local v = direction.vector(inp.direction)
    local tx, ty = math.floor(inp.position.x), math.floor(inp.position.y)
    sources[inp.item] =
      { x = tx + v.x, y = ty + v.y, dir = inp.direction, from_x = tx, from_y = ty, label = "input port " .. inp.item }
  end
  local nets = {}
  for _, o in ipairs(problem.outputs) do
    local src = sources[o.item]
    nets[#nets + 1] = {
      item = o.item,
      from = src,
      goals = { { x = math.floor(o.position.x), y = math.floor(o.position.y), dirs = routing.into_port(o) } },
      label = src.label .. " -> output port " .. o.item,
    }
  end
  return nets, {}
end

-- next permutation in lexicographic order (in place); false when it was the last one
local function next_permutation(a)
  local i = #a - 1
  while i >= 1 and a[i] >= a[i + 1] do
    i = i - 1
  end
  if i < 1 then
    return false
  end
  local j = #a
  while a[j] <= a[i] do
    j = j - 1
  end
  a[i], a[j] = a[j], a[i]
  local l, r = i + 1, #a
  while l < r do
    a[l], a[r] = a[r], a[l]
    l, r = l + 1, r - 1
  end
  return true
end

-- placements -> blueprint entities (without entity_number)
local function to_entities(all, problem)
  local entities = {}
  for _, p in ipairs(all) do
    local e = { position = { x = p.x + 0.5, y = p.y + 0.5 } }
    if p.kind == "belt" then
      e.name = problem.tiers.belt
    else
      e.name = problem.tiers.underground
      e.type = p.kind == "underground-input" and "input" or "output"
    end
    if p.dir ~= direction.NORTH then
      e.direction = p.dir
    end
    entities[#entities + 1] = e
  end
  return entities
end

routing.GREEDY_ORDERS = 24 -- net orders tried before negotiating
routing.NEGOTIATION_ROUNDS = 40

-- what one net's route uses: tiles, tiles its belts point into, underground tunnels (with axis)
local function usage_of(placed)
  local u = { tiles = {}, fed = {}, tunnels = {} }
  local entrance
  for _, p in ipairs(placed) do
    u.tiles[key(p.x, p.y)] = true
    local v = direction.vector(p.dir)
    if p.kind == "belt" or p.kind == "underground-output" then
      u.fed[key(p.x + v.x, p.y + v.y)] = true
    end
    if p.kind ~= "belt" then
      u.tunnels[key(p.x, p.y)] = p.dir % 8
    end
    if p.kind == "underground-input" then
      entrance = p
    elseif p.kind == "underground-output" and entrance then
      local dx = (p.x > entrance.x and 1) or (p.x < entrance.x and -1) or 0
      local dy = (p.y > entrance.y and 1) or (p.y < entrance.y and -1) or 0
      local x, y = entrance.x + dx, entrance.y + dy
      while x ~= p.x or y ~= p.y do
        u.tunnels[key(x, y)] = p.dir % 8
        x, y = x + dx, y + dy
      end
      entrance = nil
    end
  end
  return u
end

-- collisions between the nets' routes: a tile used twice, a belt pointing into another net, crossing
-- tunnels on one axis
local function conflicts_of(usage, n)
  local conflicts = {}
  for i = 1, n do
    for j = i + 1, n do
      local a, b = usage[i], usage[j]
      for k in pairs(a.tiles) do
        if b.tiles[k] or b.fed[k] then
          conflicts[k] = true
        end
      end
      for k in pairs(b.tiles) do
        if a.fed[k] then
          conflicts[k] = true
        end
      end
      for k, axis in pairs(a.tunnels) do
        if b.tunnels[k] == axis then
          conflicts[k] = true
        end
      end
    end
  end
  return conflicts
end

--- Route all nets, in steps. base_entities: blueprint entities already placed (rows and ports).
--- First the fast way: each net in turn with the cheapest route, trying some net orders. If no order
--- works, negotiated congestion (PathFinder): every net is routed again each round; tiles other nets
--- use cost extra (growing each round), and tiles that were fought over get a lasting history cost,
--- until no two nets collide. Hard obstacles (rows, ports, reservations) stay hard.
--- route_new makes the state (plain data, no functions: it can live in the game's storage);
--- route_step runs up to `budget` search steps and returns the steps used. When st.done: st.result is
--- the list of new blueprint entities (without entity_number), or nil and st.errors.
function routing.route_new(nets, base_entities, problem, pack, counter)
  local ug = pack.undergrounds[problem.tiers.underground]
  local opts = {
    max_distance = ug.max_distance,
    underground = problem.tiers.underground,
    reserved = {},
    nets_count = #nets,
    max_expansions=problem.max_route_expansions,
    heuristic_weight=problem.heuristic_weight,
  }
  for i, net in ipairs(nets) do
    for _, t in ipairs(net.reserve or {}) do
      opts.reserved[key(t.x, t.y)] = i
    end
  end
  local order = {}
  for i = 1, #nets do
    order[i] = i
  end
  local st = {
    nets = nets,
    base = base_entities,
    obstacles = problem.obstacles,
    area = problem.area,
    belt = problem.tiers.belt,
    opts = opts,
    order = order,
    tried = 0,
    phase = "greedy",
    counter = counter or routing.new_counter(),
  }
  return st
end

local function finish(st, routes_or_all, flat)
  local all = routes_or_all
  if not flat then
    all = {}
    for _, placed in ipairs(routes_or_all) do
      for _, p in ipairs(placed) do
        all[#all + 1] = p
      end
    end
  end
  st.done, st.result = true, to_entities(all, { tiers = { belt = st.belt, underground = st.opts.underground } })
  st.world, st.search, st.all, st.n = nil, nil, nil, nil
end

local function fail(st, why)
  local last_failed = st.last_failed .. "; negotiation: " .. why
  if over_limit(st.counter) then
    last_failed = last_failed .. "; the search hit its work limit"
  end
  st.done = true
  st.errors = {
    issues.new(
      "no-route",
      "no belt route from " .. last_failed .. " (tried " .. st.tried .. " orders)",
      "move the ports or make the area larger: the belts cannot get through"
    ),
  }
  st.world, st.search, st.n = nil, nil, nil
end

function routing.route_step(st, pack, budget)
  local used = 0
  local nets, opts = st.nets, st.opts
  while not st.done and used < budget do
    if st.phase == "greedy" then
      if not st.world then
        st.tried = st.tried + 1
        st.world, st.all, st.idx = build_world(st.base, pack, st.obstacles), {}, 1
      end
      if st.idx > #st.order then
        finish(st, st.all, true)
        return used
      end
      local i = st.order[st.idx]
      opts.net, opts.soft = i, nil
      st.search = st.search or routing.search_new(nets[i].from, nets[i].goals)
      used = used + routing.search_step(st.search, st.world, st.area, opts, st.counter, budget - used)
      if st.search.done then
        local placed = st.search.result
        st.search = nil
        if placed then
          add_to_world(st.world, placed, opts.underground)
          for _, p in ipairs(placed) do
            st.all[#st.all + 1] = p
          end
          st.idx = st.idx + 1
        else
          st.last_failed = nets[i].label
          st.world, st.all = nil, nil
          if st.tried >= routing.GREEDY_ORDERS then st.phase = "negotiate"
          elseif st.idx>1 then
            -- Rip up around the blocked connection instead of permuting unrelated
            -- connections at the end of the order and repeating the same failure.
            table.remove(st.order,st.idx);table.insert(st.order,1,i)
          elseif not next_permutation(st.order) then st.phase = "negotiate" end
        end
      end
    else
      if not st.n then
        -- start negotiating
        st.world = build_world(st.base, pack, st.obstacles)
        st.history, st.usage, st.routes, st.present = {}, {}, {}, 1
        st.round, st.n = 1, 1
      end
      local i = st.n
      if not st.search then
        st.usage[i] = nil
        st.search = routing.search_new(nets[i].from, nets[i].goals)
      end
      opts.net = i
      opts.soft = { history = st.history, usage = st.usage, present = st.present, net = i }
      used = used + routing.search_step(st.search, st.world, st.area, opts, st.counter, budget - used)
      opts.soft = nil
      if st.search.done then
        local placed = st.search.result
        st.search = nil
        if not placed then
          fail(st, nets[i].label)
          return used
        end
        st.routes[i], st.usage[i] = placed, usage_of(placed)
        st.n = i + 1
        if st.n > #nets then
          local conflicts = conflicts_of(st.usage, #nets)
          if next(conflicts) == nil then
            finish(st, st.routes, false)
            return used
          end
          for k in pairs(conflicts) do
            st.history[k] = (st.history[k] or 0) + 1
          end
          st.present = st.present * 1.5
          st.round, st.n = st.round + 1, 1
          if st.round > routing.NEGOTIATION_ROUNDS then
            fail(st, "congestion did not resolve")
            return used
          end
        end
      end
    end
  end
  return used
end

--- Route all nets at once (route_new + route_step to the end). Returns list of new blueprint entities
--- (without entity_number) or nil, errors.
function routing.route(nets, base_entities, problem, pack, counter)
  local st = routing.route_new(nets, base_entities, problem, pack, counter)
  while not st.done do
    routing.route_step(st, pack, math.huge)
  end
  if st.result then
    return st.result, {}
  end
  return nil, st.errors
end

return routing
