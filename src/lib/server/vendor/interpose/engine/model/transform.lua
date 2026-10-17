--- Flip and rotate problem files (their ports and area), for testing every orientation of a layout.
--- The 8 orientations (the symmetries of a square): rotations by 0, 90, 180, 270 degrees clockwise,
--- each with and without a left-right mirror first.
local transform = {}

transform.ALL = { "identity", "rot90", "rot180", "rot270", "flip_x", "flip_x+rot90", "flip_x+rot180", "flip_x+rot270" }

local function deep_copy(t)
  if type(t) ~= "table" then
    return t
  end
  local c = {}
  for k, v in pairs(t) do
    c[k] = deep_copy(v)
  end
  return setmetatable(c, getmetatable(t))
end

-- one primitive step on (u, v) relative to the area's top-left, area size (w, h), direction d
local STEPS = {
  -- left-right mirror: east <-> west
  flip_x = function(u, v, w, h, d)
    return w - u, v, w, h, (16 - d) % 16
  end,
  -- top-bottom mirror: north <-> south
  flip_y = function(u, v, w, h, d)
    return u, h - v, w, h, (8 - d) % 16
  end,
  -- quarter turn clockwise (y grows south): the area becomes h x w
  rot90 = function(u, v, w, h, d)
    return h - v, u, h, w, (d + 4) % 16
  end,
}

local function steps_of(name)
  local list = {}
  for part in name:gmatch("[^+]+") do
    local turns = part:match("^rot(%d+)$")
    if turns then
      for _ = 1, tonumber(turns) / 90 do
        list[#list + 1] = "rot90"
      end
    elseif STEPS[part] then
      list[#list + 1] = part
    elseif part ~= "identity" then
      error("unknown transform " .. part)
    end
  end
  return list
end

--- Return a transformed copy of a raw problem table (as read from JSON). name: one of transform.ALL,
--- or any "+"-joined sequence of flip_x, flip_y, rot90, rot180, rot270.
function transform.problem(raw, name)
  local p = deep_copy(raw)
  local a = p.area
  local x1, y1 = a[1][1], a[1][2]
  local w, h = a[2][1] - x1, a[2][2] - y1
  local ports = {}
  for _, inp in ipairs(p.inputs or {}) do
    ports[#ports + 1] = inp
  end
  if p.output then
    ports[#ports + 1] = p.output
  end
  for _, o in ipairs(p.outputs or {}) do
    ports[#ports + 1] = o
  end
  for _, step in ipairs(steps_of(name)) do
    local nw, nh
    for _, pt in ipairs(ports) do
      local u, v, d
      u, v, nw, nh, d = STEPS[step](pt.position.x - x1, pt.position.y - y1, w, h, pt.direction or 0)
      pt.position = { x = x1 + u, y = y1 + v }
      pt.direction = d
    end
    -- obstacle and ore tiles (top-left corners) turn about their centres
    for _, field in ipairs({ "obstacles", "resources" }) do
      local list = p[field]
      for _, t in ipairs(type(list) == "table" and list or {}) do
        if type(t) == "table" and type(t.x) == "number" and type(t.y) == "number" then
          local u, v = STEPS[step](t.x + 0.5 - x1, t.y + 0.5 - y1, w, h, 0)
          t.x, t.y = x1 + math.floor(u), y1 + math.floor(v)
        end
      end
    end
    if not nw then
      nw, nh = select(3, STEPS[step](0, 0, w, h, 0))
    end
    w, h = nw, nh
  end
  p.area = { { x1, y1 }, { x1 + w, y1 + h } }
  if p.description then
    p.description = p.description .. " [" .. name .. "]"
  end
  return p
end

--- Transformed copies of blueprint entities (positions are centres, as in a blueprint) that lie in
--- `area` ({{x1, y1}, {x2, y2}}). Returns the entities and the transformed area. Used to turn a layout
--- that was solved in a turned copy of the problem back into the problem's own orientation.
function transform.entities(entities, area, name)
  local x1, y1 = area[1][1], area[1][2]
  local w, h = area[2][1] - x1, area[2][2] - y1
  local out = {}
  for i, e in ipairs(entities) do
    out[i] = deep_copy(e)
  end
  for _, step in ipairs(steps_of(name)) do
    local nw, nh
    for _, e in ipairs(out) do
      local u, v, d
      u, v, nw, nh, d = STEPS[step](e.position.x - x1, e.position.y - y1, w, h, e.direction or 0)
      for _, field in ipairs({"pickup_position", "drop_position"}) do
        local vector = e[field]
        if vector then
          local ox, oy = STEPS[step](0, 0, w, h, 0)
          local vx, vy = STEPS[step](vector.x, vector.y, w, h, 0)
          e[field] = {x=vx-ox,y=vy-oy}
        end
      end
      e.position = { x = x1 + u, y = y1 + v }
      e.direction = d ~= 0 and d or nil
    end
    if not nw then
      nw, nh = select(3, STEPS[step](0, 0, w, h, 0))
    end
    w, h = nw, nh
  end
  return out, { { x1, y1 }, { x1 + w, y1 + h } }
end

--- The transform that undoes `name` (one of transform.ALL).
transform.INVERSE = {
  identity = "identity",
  rot90 = "rot270",
  rot270 = "rot90",
  rot180 = "rot180",
  flip_x = "flip_x",
  ["flip_x+rot90"] = "rot270+flip_x",
  ["flip_x+rot180"] = "rot180+flip_x",
  ["flip_x+rot270"] = "rot90+flip_x",
}

return transform
