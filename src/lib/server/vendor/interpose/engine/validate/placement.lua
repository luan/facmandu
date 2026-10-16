--- Validation stage 5a: every tile is claimed at most once, and lies inside the allowed area.
local blueprint = require("engine.blueprint")

local placement = {}

--- Returns grid (tile key -> entity) and a list of problems (one per overlapping pair, one per
--- entity outside the area). Entities are placed in id order; the later one is reported.
--- opts.area: optional {{x1, y1}, {x2, y2}} in tiles; allowed tiles are x1 <= x < x2, y1 <= y < y2.
function placement.check(model, opts)
  local grid, problems = {}, {}
  local area = opts and opts.area
  for _, e in ipairs(model.entities) do
    local overlapped, outside = {}, false
    for _, t in ipairs(e.tiles) do
      local key = blueprint.tile_key(t[1], t[2])
      local other = grid[key]
      if other then
        if not overlapped[other.id] then
          overlapped[other.id] = true
          problems[#problems + 1] = {
            code = "collision",
            entity = e.id,
            position = { x = e.x, y = e.y },
            message = string.format("%s overlaps %s (entity %d) at tile %s", e.name, other.name, other.id, key),
          }
        end
      else
        grid[key] = e
      end
      if area and (t[1] < area[1][1] or t[2] < area[1][2] or t[1] >= area[2][1] or t[2] >= area[2][2]) then
        outside = true
      end
    end
    if outside then
      problems[#problems + 1] = {
        code = "outside-area",
        entity = e.id,
        position = { x = e.x, y = e.y },
        message = string.format("%s is (partly) outside the allowed area", e.name),
      }
    end
  end
  return grid, problems
end

return placement
