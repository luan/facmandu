-- One electric network's recent flow, plus a bounded local connection check.
local target = require("scripts.tools.target")
local bounded = require("scripts.tools.bounded")
local M = {}
M.manifest = {
  inspect_power_network = {
    desc = "Diagnose power at one built entity: network ID, generation and consumption over the last minute from a nearby pole's electric statistics, and nearby electric entities without a network. The disconnected and accumulator rows cover only the stated radius, not the whole network. A disconnected target has no network statistics.",
    tier = "2", params = { surface = "string! surface name or index", x = "number! map x", y = "number! map y", name = "string entity prototype name", unit_number = "integer entity unit number", radius = "integer local inspection radius, default 16, max 32 tiles" },
  },
}
local function power_rows(stats, category)
  local rows = {}
  local counts = category == "input" and stats.input_counts or stats.output_counts
  for name in pairs(counts or {}) do
    local per_tick = stats.get_flow_count{
      name = name, category = category,
      precision_index = defines.flow_precision_index.one_minute,
    }
    if per_tick > 0 then rows[#rows + 1] = { name = name, watts = per_tick * 60 } end
  end
  table.sort(rows, function(x, y)
    if x.watts ~= y.watts then return x.watts > y.watts end
    return x.name < y.name
  end)
  local total = 0
  for _, row in ipairs(rows) do total = total + row.watts end
  local shown = bounded.cut(rows, 10)
  for _, row in ipairs(shown) do row.watts = bounded.round(row.watts, 0) end
  return { total_watts = bounded.round(total, 0), total_kinds = #rows,
    shown = #shown, entities = shown }
end
local function inspect(a)
  local entity, miss, surface, force = target.find(a)
  if not entity then return miss end
  local radius = bounded.limit(a.radius, 16, 32)
  local id = entity.electric_network_id
  local nearby = surface.find_entities_filtered{
    position = entity.position, radius = radius, force = force.name, limit = 1200,
  }
  local pole = entity.type == "electric-pole" and entity or nil
  local disconnected, accumulators = {}, {}
  local stored, capacity = 0, 0
  for _, other in ipairs(nearby) do
    if other.valid and other.type ~= "entity-ghost" then
      if id and not pole and other.type == "electric-pole" and other.electric_network_id == id then
        pole = other
      end
      local source = other.prototype.electric_energy_source_prototype
      if source and not other.electric_network_id then
        disconnected[#disconnected + 1] = { name = other.name, unit_number = other.unit_number,
          x = other.position.x, y = other.position.y }
      end
      if other.type == "accumulator" and other.electric_network_id == id then
        stored = stored + other.energy
        capacity = capacity + (other.electric_buffer_size or 0)
        accumulators[#accumulators + 1] = other
      end
    end
  end
  local row = { found = true, force = force.name, surface = surface.name,
    name = entity.name, unit_number = entity.unit_number,
    x = entity.position.x, y = entity.position.y,
    network_id = id, radius = radius, scanned = #nearby,
    truncated = #nearby == 1200,
    disconnected_nearby_total = #disconnected,
    disconnected_nearby = bounded.cut(disconnected, 12),
    nearby_accumulators = #accumulators,
    nearby_accumulator_stored_j = bounded.round(stored, 0),
    nearby_accumulator_capacity_j = bounded.round(capacity, 0),
  }
  if pole then
    local stats = pole.electric_network_statistics
    if stats then
      -- Electric flow statistics call consumption "input" and production "output".
      row.consumption = power_rows(stats, "input")
      row.generation = power_rows(stats, "output")
      row.window = "one_minute"
    end
  end
  return row
end
M.functions = { inspect_power_network = inspect }
return M
