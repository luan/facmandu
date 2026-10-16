--- Balancer blocks (open action 39): splitters that divide N input belts of one item fairly over M
--- output belts. Blocks flow east; coordinates are relative to the block's top-left tile.
---
---   1 -> 2   one splitter
---   2 -> 2   one splitter (both inputs are mixed, both outputs get half of the total)
---   2 -> 1   one splitter with one output left free: everything leaves by the other (a merge)
---   2 -> 4   a splitter balances the two inputs, then each half is split again
---   1 -> 4   the same with one input
---   4 -> 2   each pair is merged into one belt (splitter with a free output), then a splitter balances
---            the two; balanced as long as each pair fits on one belt
---   4 -> 1   the same, and the last splitter merges too
---
--- An output tile a splitter leaves free must stay empty: the router never builds there, because the
--- splitter "feeds" that tile.
local direction = require("engine.model.direction")

local balancer = {}

-- one splitter facing east in column c, covering rows r and r+1
local function splitter(list, c, r)
  list[#list + 1] = { kind = "splitter", c = c, r = r }
end

local function belt(list, c, r)
  list[#list + 1] = { kind = "belt", c = c, r = r }
end

--- The block for n inputs and m outputs, or nil when that combination is not supported.
--- Returns { width, height, parts = {{kind, c, r}}, inputs = {{c, r}}, outputs = {{c, r, feeder_c, feeder_r}} }
--- inputs: the tile items must enter, moving east (a splitter tile).
--- outputs: the tile items leave to, moving east; feeder = the splitter's top tile (for the router).
function balancer.block(n, m)
  local parts, inputs, outputs = {}, {}, {}
  if (n == 1 or n == 2) and (m == 1 or m == 2) and not (n == 1 and m == 1) then
    splitter(parts, 0, 0)
    for r = 0, n - 1 do
      inputs[#inputs + 1] = { c = 0, r = r }
    end
    for r = 0, m - 1 do
      outputs[#outputs + 1] = { c = 1, r = r, feeder_c = 0, feeder_r = 0 }
    end
    return { width = 2, height = 2, parts = parts, inputs = inputs, outputs = outputs }
  elseif (n == 1 or n == 2) and m == 4 then
    splitter(parts, 0, 1)
    belt(parts, 1, 1)
    belt(parts, 1, 2)
    splitter(parts, 2, 0)
    splitter(parts, 2, 2)
    for r = 1, n do
      inputs[#inputs + 1] = { c = 0, r = r }
    end
    for r = 0, 3 do
      outputs[#outputs + 1] = { c = 3, r = r, feeder_c = 2, feeder_r = r < 2 and 0 or 2 }
    end
    return { width = 4, height = 4, parts = parts, inputs = inputs, outputs = outputs }
  elseif n == 4 and (m == 1 or m == 2) then
    splitter(parts, 0, 0)
    splitter(parts, 0, 2)
    belt(parts, 1, 1) -- the inner outputs of the two merging splitters; (1,0) and (1,3) stay empty
    belt(parts, 1, 2)
    splitter(parts, 2, 1)
    for r = 0, 3 do
      inputs[#inputs + 1] = { c = 0, r = r }
    end
    for r = 1, m do
      outputs[#outputs + 1] = { c = 3, r = r, feeder_c = 2, feeder_r = 1 }
    end
    return { width = 4, height = 4, parts = parts, inputs = inputs, outputs = outputs }
  end
  return nil
end

--- The block turned to face `dir` (it is built facing east). Returns { width, height,
---   parts = {{kind, dir, tiles = {{x, y}}}}, inputs = {{x, y, dir}}, outputs = {{x, y, dir, feeder = {x, y}}} }
--- with tiles relative to the turned block's top-left; feeder = top-left tile of the splitter that
--- feeds the output tile.
function balancer.oriented(block, dir)
  local turns = ((dir - direction.EAST) % 16) / 4
  local w, h = block.width, block.height
  local function turn(x, y)
    local tw, th = w, h
    for _ = 1, turns do
      x, y = th - 1 - y, x -- a quarter clockwise in a tw x th box
      tw, th = th, tw
    end
    return x, y
  end
  local width, height = w, h
  if turns % 2 == 1 then
    width, height = h, w
  end
  local out = { width = width, height = height, parts = {}, inputs = {}, outputs = {} }
  local splitter_tiles = {}
  for _, p in ipairs(block.parts) do
    local tiles = {}
    local list = p.kind == "splitter" and { { p.c, p.r }, { p.c, p.r + 1 } } or { { p.c, p.r } }
    for _, t in ipairs(list) do
      local x, y = turn(t[1], t[2])
      tiles[#tiles + 1] = { x, y }
    end
    out.parts[#out.parts + 1] = { kind = p.kind, dir = dir, tiles = tiles }
    if p.kind == "splitter" then
      local tl = { math.min(tiles[1][1], tiles[2][1]), math.min(tiles[1][2], tiles[2][2]) }
      splitter_tiles[p.c .. "," .. p.r] = tl
    end
  end
  for _, t in ipairs(block.inputs) do
    local x, y = turn(t.c, t.r)
    out.inputs[#out.inputs + 1] = { x = x, y = y, dir = dir }
  end
  for _, t in ipairs(block.outputs) do
    local x, y = turn(t.c, t.r)
    out.outputs[#out.outputs + 1] =
      { x = x, y = y, dir = dir, feeder = splitter_tiles[t.feeder_c .. "," .. t.feeder_r] }
  end
  return out
end

--- Blueprint entities for an oriented block (balancer.oriented) placed with its top-left tile at (bx, by).
function balancer.entities(block, bx, by, tiers)
  local out = {}
  for _, p in ipairs(block.parts) do
    -- the centre of the part's tiles: a splitter's centre lies on the line between its two tiles
    local x1, y1, x2, y2 = math.huge, math.huge, -math.huge, -math.huge
    for _, t in ipairs(p.tiles) do
      x1, y1 = math.min(x1, t[1]), math.min(y1, t[2])
      x2, y2 = math.max(x2, t[1]), math.max(y2, t[2])
    end
    out[#out + 1] = {
      name = p.kind == "splitter" and tiers.splitter or tiers.belt,
      position = { x = bx + (x1 + x2 + 1) / 2, y = by + (y1 + y2 + 1) / 2 },
      direction = p.dir,
    }
  end
  return out
end

--- The splitter tier that goes with a belt tier (the game's naming), or nil.
function balancer.splitter_for(belt_name, pack)
  local name = belt_name:gsub("transport%-belt$", "splitter")
  if name ~= belt_name and pack.splitters and pack.splitters[name] then
    return name
  end
  return nil
end

return balancer
