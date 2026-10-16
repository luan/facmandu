--- Factorio 2.0 directions: 16-way, clockwise from north. The engine supports the four cardinal ones.
--- Coordinates: x grows east, y grows south (screen coordinates, as in the game).
local direction = {}

direction.NORTH = 0
direction.EAST = 4
direction.SOUTH = 8
direction.WEST = 12

local VECTORS = {
  [0] = { x = 0, y = -1 },
  [4] = { x = 1, y = 0 },
  [8] = { x = 0, y = 1 },
  [12] = { x = -1, y = 0 },
}

function direction.is_cardinal(d)
  return VECTORS[d] ~= nil
end

--- Unit vector of a cardinal direction.
function direction.vector(d)
  local v = assert(VECTORS[d], "not a cardinal direction: " .. tostring(d))
  return { x = v.x, y = v.y }
end

function direction.opposite(d)
  return (d + 8) % 16
end

--- Rotate a vector given for a north-facing entity to direction d (clockwise in screen coordinates).
function direction.rotate(v, d)
  assert(VECTORS[d], "not a cardinal direction: " .. tostring(d))
  local x, y = v.x, v.y
  for _ = 1, d / 4 do
    x, y = -y, x
  end
  return { x = x, y = y }
end

return direction
