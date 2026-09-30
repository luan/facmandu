-- Exact entity logistic requests, including inactive sections and multipliers.
local target = require("scripts.tools.target")
local bounded = require("scripts.tools.bounded")
local M = {}
M.manifest = {
  inspect_logistic_requests = {
    desc = "Inspect configured logistic requests on one built chest, machine, or platform hub at map coordinates. Reports section active state and multiplier, and request min/max per filter. These are settings, not deliveries or logistic-network inventory.",
    tier = "2", params = { surface = "string! surface name or index", x = "number! map x", y = "number! map y", name = "string entity prototype name", unit_number = "integer entity unit number" },
  },
}
local function inspect(a)
  local entity, miss, surface, force = target.find(a)
  if not entity then return miss end
  local sections = entity.get_logistic_sections()
  if not sections then
    return { found = true, force = force.name, surface = surface.name,
      name = entity.name, unit_number = entity.unit_number, x = entity.position.x,
      y = entity.position.y, supports_requests = false, sections = {} }
  end
  local rows = {}
  for _, section in ipairs(sections.sections) do
    local filters = {}
    for _, filter in ipairs(section.filters) do
      local value = filter.value
      if value then
        filters[#filters + 1] = { name = value.name, type = value.type,
          quality = value.quality, comparator = value.comparator,
          min = filter.min, max = filter.max,
          import_from = filter.import_from, request_from = filter.request_from }
      end
    end
    rows[#rows + 1] = { index = section.index, group = section.group,
      active = section.active, multiplier = section.multiplier,
      total_filters = #filters, filters = bounded.cut(filters, 10) }
    if #rows == 4 then break end
  end
  return { found = true, force = force.name, surface = surface.name,
    name = entity.name, unit_number = entity.unit_number,
    x = entity.position.x, y = entity.position.y, supports_requests = true,
    total_sections = sections.sections_count, shown_sections = #rows,
    sections = rows }
end
M.functions = { inspect_logistic_requests = inspect }
return M
