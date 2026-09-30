-- Targeted train and stop reads. No fleet walk.
local target = require("scripts.tools.target")
local force_lookup = require("scripts.tools.force_lookup")
local surface_lookup = require("scripts.tools.surface_lookup")
local bounded = require("scripts.tools.bounded")
local M = {}
M.manifest = {
  list_trains = {
    desc = "List train IDs for one force on one surface, with state and station, so a train can be selected for inspect_train. Returns at most 20 rows and reports total.",
    tier = "2", params = { surface = "string! surface name or index", limit = "integer trains to show, default 10, max 20" },
  },
  inspect_train = {
    desc = "Inspect one train by ID: state, path, stop, simplified station schedule, cargo and fluid contents. The simplified schedule omits interrupts; the reply says so. Use trains for fleet counts.",
    tier = "2", params = { train_id = "integer! ID returned by a train or stop", },
  },
  inspect_train_stop = {
    desc = "Inspect one built train stop at exact map coordinates: stop name, train limit, count, priority, and stopped train ID. An unbounded limit is reported as such.",
    tier = "2", params = { surface = "string! surface name or index", x = "number! map x", y = "number! map y", name = "string train-stop prototype name", unit_number = "integer entity unit number" },
  },
}
local function state_name(state)
  for name, value in pairs(defines.train_state) do if value == state then return name end end
  return tostring(state)
end
local function contents(rows, max)
  table.sort(rows, function(x, y)
    if x.count ~= y.count then return x.count > y.count end
    return x.name < y.name
  end)
  return { total_kinds = #rows, shown = math.min(#rows, max), items = bounded.cut(rows, max) }
end
local function list_trains(a)
  local force = force_lookup.require_force(a.force)
  local surface, miss = surface_lookup.find(a.surface)
  if not surface then miss.force = force.name; return miss end
  local trains = game.train_manager.get_trains{ force = force.name, surface = surface.name }
  table.sort(trains, function(x, y) return x.id < y.id end)
  local rows = {}
  for _, train in ipairs(bounded.cut(trains, bounded.limit(a.limit, 10, 20))) do
    local first = train.carriages[1]
    rows[#rows + 1] = { train_id = train.id, state = state_name(train.state),
      station = train.station and train.station.backer_name or nil,
      x = first and first.position.x or nil, y = first and first.position.y or nil }
  end
  return { found = true, force = force.name, surface = surface.name,
    total = #trains, shown = #rows, trains = rows }
end
local function inspect_train(a)
  local force = force_lookup.require_force(a.force)
  local id = tonumber(a.train_id)
  if not id or id < 1 or id ~= math.floor(id) then error("train_id must be a positive integer", 0) end
  local train = game.train_manager.get_train_by_id(id)
  if not train or not train.valid or not train.carriages[1] or train.carriages[1].force ~= force then
    return { found = false, force = force.name, train_id = id, reason = "no train by that ID for this force" }
  end
  local first = train.carriages[1]
  local schedule = train.schedule
  local stops = {}
  if schedule then
    for i, record in ipairs(schedule.records or {}) do
      local conditions = {}
      for _, condition in ipairs(record.wait_conditions or {}) do
        conditions[#conditions + 1] = {
          type = condition.type, compare_type = condition.compare_type,
          ticks = condition.ticks, condition = condition.condition,
        }
        if #conditions == 4 then break end
      end
      stops[#stops + 1] = { index = i, station = record.station,
        temporary = record.temporary or false,
        wait_conditions_total = #(record.wait_conditions or {}),
        wait_conditions_shown = #conditions, wait_conditions = conditions }
      if #stops == 8 then break end
    end
  end
  local fluids = {}
  for name, amount in pairs(train.get_fluid_contents()) do
    fluids[#fluids + 1] = { name = name, amount = bounded.round(amount, 2) }
  end
  table.sort(fluids, function(x, y) return x.name < y.name end)
  return { found = true, force = force.name, train_id = id,
    surface = first.surface.name, x = first.position.x, y = first.position.y,
    state = state_name(train.state), speed = bounded.round(train.speed, 2),
    manual = train.manual_mode, has_path = train.has_path, group = train.group,
    station = train.station and train.station.backer_name or nil,
    destination = train.path_end_stop and train.path_end_stop.backer_name or nil,
    schedule = { current = schedule and schedule.current or nil,
      total = schedule and #schedule.records or 0, shown = #stops, records = stops,
      interrupts_included = false },
    cargo = contents(train.get_contents(), 16),
    fluids = { total_kinds = #fluids, fluids = bounded.cut(fluids, 12) },
  }
end
local function inspect_train_stop(a)
  local entity, miss, surface, force = target.find(a)
  if not entity then return miss end
  if entity.type ~= "train-stop" then
    return { found = false, force = force.name, surface = surface.name,
      name = entity.name, reason = "entity is not a train stop" }
  end
  local stopped = entity.get_stopped_train()
  local limit = entity.trains_limit
  return { found = true, force = force.name, surface = surface.name,
    name = entity.name, station = entity.backer_name, unit_number = entity.unit_number,
    x = entity.position.x, y = entity.position.y,
    trains_count = entity.trains_count, trains_limit = limit,
    limit_enabled = limit ~= nil, priority = entity.train_stop_priority,
    stopped_train_id = stopped and stopped.id or nil }
end
M.functions = { list_trains = list_trains, inspect_train = inspect_train, inspect_train_stop = inspect_train_stop }
return M
