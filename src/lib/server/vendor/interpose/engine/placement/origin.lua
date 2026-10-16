--- Where does a block of w x h tiles go? Inside the area with `margin` free tiles around it; no port,
--- nor the tile a port points at, within `margin` tiles of the block (that ring is where belts run);
--- clear of earlier blocks (`avoid`: rectangles {x, y, w, h}, also kept `margin` apart); no obstacle
--- tile (problem.obstacles) inside the block (routes find their way around them in the ring). Among
--- the candidates, the one closest to the ports (sum of distances); ties: top-most, left-most.
local direction = require("engine.model.direction")

local origin = {}

--- west (optional): free columns to keep west of the block instead of `margin`: the rows take their
--- ingredients at their west ends, so with many of them the belts need a wider corridor there.
function origin.choose(problem, w, h, margin, avoid, west)
  local a = problem.area
  west = math.max(west or margin, margin)
  local ports = {}
  for _, inp in ipairs(problem.inputs) do
    ports[#ports + 1] = inp
  end
  for _, o in ipairs(problem.outputs or { problem.output }) do
    ports[#ports + 1] = o
  end
  -- obstacles per tile, summed: blocked(x1, y1, x2, y2) counts them in a rectangle at once
  local ax, ay, aw = a[1][1], a[1][2], a[2][1] - a[1][1]
  local sum = {}
  local function at(x, y) -- obstacles in tiles ax..x-1, ay..y-1
    return sum[(y - ay) * (aw + 1) + (x - ax)] or 0
  end
  local grid = {}
  for _, t in ipairs(problem.obstacles or {}) do
    grid[t.x .. "," .. t.y] = true
  end
  if next(grid) then
    for y = ay, a[2][2] - 1 do
      local row = 0
      for x = ax, a[2][1] - 1 do
        row = row + (grid[x .. "," .. y] and 1 or 0)
        sum[(y + 1 - ay) * (aw + 1) + (x + 1 - ax)] = at(x + 1, y) + row
      end
    end
  end
  local function blocked(x1, y1, x2, y2)
    return at(x2, y2) - at(x1, y2) - at(x2, y1) + at(x1, y1) > 0
  end
  local best, best_cost
  for by = a[1][2] + margin, a[2][2] - margin - h do
    for bx = a[1][1] + west, a[2][1] - margin - w do
      local function near(x, y, ring)
        return x >= bx - ring and x < bx + w + ring and y >= by - ring and y < by + h + ring
      end
      local ok, cost = true, 0
      for _, pt in ipairs(ports) do
        local tx, ty = math.floor(pt.position.x), math.floor(pt.position.y)
        local v = direction.vector(pt.direction)
        if near(tx, ty, margin) or near(tx + v.x, ty + v.y, margin) then
          ok = false
          break
        end
        cost = cost + math.abs(tx - (bx + w / 2)) + math.abs(ty - (by + h / 2))
      end
      for _, r in ipairs(ok and avoid or {}) do
        if bx < r.x + r.w + margin and r.x < bx + w + margin and by < r.y + r.h + margin and r.y < by + h + margin then
          ok = false
        end
      end
      if ok and next(grid) and blocked(bx, by, bx + w, by + h) then
        ok = false
      end
      if ok and (not best_cost or cost < best_cost) then
        best, best_cost = { bx, by }, cost
      end
    end
  end
  return best
end

return origin
