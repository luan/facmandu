-- A specific built entity near a map position. No surface-wide search.
local force_lookup = require("scripts.tools.force_lookup")
local surface_lookup = require("scripts.tools.surface_lookup")

local M = {}

function M.find(a)
  local force = force_lookup.require_force(a.force)
  local surface, miss = surface_lookup.find(a.surface)
  if not surface then miss.force = force.name; return nil, miss end
  if type(a.x) ~= "number" or type(a.y) ~= "number" then
    error("x and y map coordinates are required", 0)
  end
  if a.name ~= nil and (type(a.name) ~= "string" or a.name == "") then
    error("name must be an entity prototype name", 0)
  end
  if a.name and not prototypes.entity[a.name] then
    return nil, { found = false, force = force.name, surface = surface.name,
      name = a.name, reason = "no entity prototype by that name" }
  end
  local at = { x = a.x, y = a.y }
  local found = surface.find_entities_filtered{
    position = at, radius = 1, force = force.name, name = a.name, limit = 20,
  }
  local matches = {}
  for _, entity in ipairs(found) do
    if entity.valid and entity.type ~= "entity-ghost" and
       (a.unit_number == nil or entity.unit_number == a.unit_number) then
      matches[#matches + 1] = entity
    end
  end
  if #matches == 0 then
    return nil, { found = false, force = force.name, surface = surface.name,
      x = a.x, y = a.y, truncated = #found == 20,
      reason = "no matching built entity within one tile" }
  end
  if #matches > 1 then
    local choices = {}
    for i, entity in ipairs(matches) do
      choices[i] = { name = entity.name, unit_number = entity.unit_number,
        x = entity.position.x, y = entity.position.y }
    end
    return nil, { found = false, ambiguous = true, force = force.name,
      surface = surface.name, choices = choices,
      reason = "several entities are here: pass name and unit_number" }
  end
  return matches[1], nil, surface, force
end

return M
