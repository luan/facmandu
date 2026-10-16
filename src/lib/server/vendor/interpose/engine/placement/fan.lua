--- Splitting one supply over several users (M10): a staircase of splitters right where the supply's
--- items arrive (the tile in front of an input port, or past the end of a row's output belt).
---
---   k users need k - 1 splitters. Splitter j sits j - 1 tiles deep and j - 1 tiles to the side (on
---   side s, left or right of the flow); its outer tile is fed by the splitter before it. Every splitter
---   but the last lets one output go to a user; the last one lets both go.
---
---     flow ->   [S1]  o1
---               [S1][S2]  o2
---                   [S2]  o3        (k = 3, side = right of the flow)
---
--- A splitter divides by what is taken: when one user's belt backs up, the items go to the others,
--- so every user gets what it needs as long as the supply carries the total.
local direction = require("engine.model.direction")

local fan = {}

--- Place a fan for `source` ({x, y, dir, label}: items arrive on tile (x, y) moving dir) and k users.
--- free(x, y) says whether a tile may be used. side: 1 = right of the flow, -1 = left.
--- prioritise: every splitter prefers its inner output (towards the users earlier in the order), so the
--- last user only gets what the others leave (an output port behind rows that need the item).
--- Returns { entities = splitter blueprint entities, outputs = { source tables, in lateral order },
--- tiles = { {x, y} used } }
--- or nil when a tile is not free.
function fan.place(source, k, side, free, splitter_name, prioritise)
  local v = direction.vector(source.dir)
  local u = direction.vector((source.dir + 4) % 16)
  u.x, u.y = u.x * side, u.y * side
  local function tile(depth, lateral)
    return source.x + v.x * depth + u.x * lateral, source.y + v.y * depth + u.y * lateral
  end
  local entities, outputs, used, tiles = {}, {}, {}, {}
  local function take(x, y)
    local key = x .. "," .. y
    if used[key] or not free(x, y) then
      return false
    end
    used[key] = true
    tiles[#tiles + 1] = { x, y }
    return true
  end
  for j = 1, k - 1 do
    local ax, ay = tile(j - 1, j - 1)
    local bx, by = tile(j - 1, j)
    if not take(ax, ay) or not take(bx, by) then
      return nil
    end
    entities[#entities + 1] = {
      name = splitter_name,
      position = {
        x = (math.min(ax, bx) + math.max(ax, bx) + 1) / 2,
        y = (math.min(ay, by) + math.max(ay, by) + 1) / 2,
      },
      direction = source.dir,
      -- the inner output lies on the side away from `side`: left of the flow when side is right
      output_priority = prioritise and (side == 1 and "left" or "right") or nil,
    }
    -- the router knows a splitter by its top-left tile
    local fx, fy = math.min(ax, bx), math.min(ay, by)
    local laterals = j < k - 1 and { j - 1 } or { j - 1, j }
    for _, l in ipairs(laterals) do
      local ox, oy = tile(j, l)
      if not take(ox, oy) then
        return nil
      end
      outputs[#outputs + 1] = {
        x = ox,
        y = oy,
        dir = source.dir,
        from_x = fx,
        from_y = fy,
        lateral = l,
        label = source.label .. " splitter " .. j,
      }
    end
  end
  return { entities = entities, outputs = outputs, tiles = tiles }
end

return fan
