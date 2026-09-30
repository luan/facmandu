local function fail(message) error(message, 0) end

local function queue_names(force)
  local names = {}
  for _, entry in ipairs(force.research_queue or {}) do
    names[#names + 1] = type(entry) == "string" and entry or entry.name
  end
  return names
end

local function same_list(a, b)
  if #a ~= #b then return false end
  for i, value in ipairs(a) do if value ~= b[i] then return false end end
  return true
end

local function research_snapshot(force)
  local current = force.current_research
  local names = queue_names(force)
  if #names > 200 then fail("Research queue is too long for assistant actions") end
  return {
    force = force.name,
    queue = names,
    researching = current and current.name or nil,
    progress = current and force.research_progress or nil,
  }
end

local function research_action(request)
  local force = game.forces[request.force]
  if not force then fail("Force no longer exists") end
  local before = research_snapshot(force)
  if not same_list(before.queue, request.expectedQueue) then fail("Research queue changed; inspect it again") end
  local operation = request.operation
  if operation == "research_add" then
    local tech = force.technologies[request.technology]
    if not tech or not tech.enabled or tech.researched then fail("Technology is unavailable") end
    if tech.prototype.research_trigger then fail("This technology needs an in-game trigger, not a research queue") end
    local queued = {}
    for _, name in ipairs(before.queue) do queued[name] = true end
    for _, prerequisite in pairs(tech.prerequisites) do
      if not prerequisite.researched and not queued[prerequisite.name] then
        fail("Technology prerequisites are incomplete")
      end
    end
    if not force.add_research(request.technology) then fail("Technology could not be queued") end
    local after_queue = queue_names(force)
    if #after_queue ~= #before.queue + 1 then fail("Factorio did not append exactly one technology") end
    for i, name in ipairs(before.queue) do
      if after_queue[i] ~= name then fail("Existing research queue changed unexpectedly") end
    end
    if after_queue[#after_queue] ~= request.technology then fail("Technology was not appended") end
  elseif operation == "research_cancel" then
    if #before.queue == 0 then fail("There is no current research") end
    force.cancel_current_research()
  else
    local changed = queue_names(force)
    local from = operation == "research_move" and request.from or request.position
    if from < 2 or from > #changed then fail("Select a queued entry after the active research") end
    if operation == "research_move" then
      if request.to < 2 or request.to > #changed then fail("Select a queued destination after the active research") end
      local entry = table.remove(changed, from)
      table.insert(changed, request.to, entry)
    else
      table.remove(changed, from)
    end
    local earlier = {}
    for _, name in ipairs(changed) do
      local tech = force.technologies[name]
      if not tech then fail("Queued technology is no longer available") end
      for _, prerequisite in pairs(tech.prerequisites) do
        if not prerequisite.researched and not earlier[prerequisite.name] then
          fail("This order would place a technology before its prerequisites")
        end
      end
      earlier[name] = true
    end
    force.research_queue = changed
    if not same_list(queue_names(force), changed) then
      force.research_queue = before.queue
      fail("Factorio could not preserve this research queue order")
    end
  end
  return { operation = operation, before = before, after = research_snapshot(force) }
end

local function research_inspect(request)
  local force = game.forces[request.force]
  if not force then fail("Force no longer exists") end
  local snapshot = research_snapshot(force)
  return { operation = request.operation, before = snapshot, after = snapshot }
end

local function train_snapshot(train)
  local schedule = train.get_schedule()
  local records = schedule and schedule.get_records() or {}
  local stations = {}
  for _, record in ipairs(records or {}) do stations[#stations + 1] = record.station or "" end
  local stock = train.carriages[1]
  return {
    trainId = train.id,
    force = stock.force.name,
    surface = stock.surface.name,
    manual = train.manual_mode,
    group = train.group or "",
    currentIndex = schedule and schedule.current or 0,
    scheduleTick = schedule and schedule.tick_of_last_schedule_change or 0,
    stations = stations,
  }
end

local function train_action(request)
  local train = game.train_manager.get_train_by_id(request.trainId)
  if not train or not train.valid or #train.carriages == 0 then fail("Train no longer exists") end
  local before = train_snapshot(train)
  if before.force ~= request.force or before.surface ~= request.surface
    or before.manual ~= request.expectedManual
    or before.group ~= request.expectedGroup
    or before.currentIndex ~= request.expectedCurrentIndex
    or before.scheduleTick ~= request.expectedScheduleTick
    or not same_list(before.stations, request.expectedStations)
  then fail("Train changed; inspect it again") end
  local operation = request.operation
  if operation == "train_manual" then
    train.manual_mode = request.manual
  elseif operation == "train_go_to" then
    local schedule = train.get_schedule()
    if not schedule or not before.stations[request.stationIndex]
      or before.stations[request.stationIndex] == "" then fail("Scheduled station no longer exists") end
    train.go_to_station(request.stationIndex)
  else
    -- Group schedules are shared; a one-train request must never edit other trains.
    if before.group ~= "" then fail("This train belongs to a shared schedule group") end
    local schedule = train.get_schedule()
    if not schedule then fail("Train has no schedule") end
    if operation == "train_add_stop" then
      if #before.stations >= 100 then fail("Train schedule is too long") end
      local wait = { type = request.wait.kind }
      if request.wait.ticks then wait.ticks = request.wait.ticks end
      local added = schedule.add_record({ station = request.station, wait_conditions = { wait } })
      if not added then fail("Factorio could not add this station") end
    elseif operation == "train_update_stop" then
      if not before.stations[request.stationIndex] then fail("Scheduled stop no longer exists") end
      local records = schedule.get_records()
      local record = records[request.stationIndex]
      if not record or not record.station then fail("Only named stations can be renamed") end
      record.station = request.station
      schedule.set_records(records)
    else
      if not before.stations[request.stationIndex] then fail("Scheduled stop no longer exists") end
      schedule.remove_record({ schedule_index = request.stationIndex })
    end
  end
  local after = train_snapshot(train)
  if operation == "train_manual" and after.manual ~= request.manual then fail("Train control did not change") end
  if operation == "train_go_to" and (after.manual or after.currentIndex ~= request.stationIndex) then
    fail("Train destination did not change")
  end
  if operation == "train_add_stop" and (#after.stations ~= #before.stations + 1
    or after.stations[#after.stations] ~= request.station) then fail("Station was not added") end
  if operation == "train_update_stop" and after.stations[request.stationIndex] ~= request.station then
    fail("Station name did not change")
  end
  if operation == "train_remove_stop" and #after.stations ~= #before.stations - 1 then
    fail("Station was not removed")
  end
  return { operation = request.operation, before = before, after = after }
end

local function train_inspect(request)
  local train = game.train_manager.get_train_by_id(request.trainId)
  if not train or not train.valid or #train.carriages == 0 then fail("Train no longer exists") end
  local snapshot = train_snapshot(train)
  return { operation = request.operation, before = snapshot, after = snapshot }
end

local function slot_request(section, slot_index)
  if slot_index > section.filters_count then return nil end
  local filter = section.get_slot(slot_index)
  if not filter or not filter.value then return nil end
  local value = filter.value
  return {
    item = type(value) == "string" and value or value.name,
    quality = type(value) == "string" and "normal" or (value.quality or "normal"),
    count = filter.min or 0,
  }
end

local function logistic_snapshot(entity, section, slot_index)
  return {
    unitNumber = entity.unit_number,
    force = entity.force.name,
    surface = entity.surface.name,
    position = { x = entity.position.x, y = entity.position.y },
    sectionIndex = section.index,
    slotIndex = slot_index,
    request = slot_request(section, slot_index),
  }
end

local function requester(request)
  local surface = game.surfaces[request.surface]
  if not surface then fail("Surface no longer exists") end
  -- Some valid requester chests lack the get-by-unit-number prototype flag.
  local entities = surface.find_entities_filtered({
    position = request.position, radius = 0.1, type = "logistic-container", limit = 8,
  })
  for _, entity in ipairs(entities) do
    if entity.unit_number == request.unitNumber and entity.position.x == request.position.x
      and entity.position.y == request.position.y then return entity end
  end
  fail("Requester no longer exists")
end

local function same_request(a, b)
  if a == nil or b == nil then return a == nil and b == nil end
  return a.item == b.item and a.quality == b.quality and a.count == b.count
end

local function logistic_action(request)
  local entity = requester(request)
  if entity.force.name ~= request.force or entity.surface.name ~= request.surface then
    fail("Requester changed; inspect it again")
  end
  local point = entity.get_requester_point()
  if not point then fail("Entity has no requester point") end
  local section = point.get_section(request.sectionIndex)
  if not section or not section.valid or not section.is_manual then fail("Request section is unavailable or controlled by the game") end
  local before = logistic_snapshot(entity, section, request.slotIndex)
  if not same_request(before.request, request.expectedRequest) then fail("Request changed; inspect it again") end
  if request.operation == "logistic_set_request" then
    if not prototypes.item[request.item] then fail("Item does not exist") end
    if not prototypes.quality[request.quality] then fail("Quality does not exist") end
    if before.request and (before.request.item ~= request.item or before.request.quality ~= request.quality) then
      fail("Clear the occupied slot before requesting another item or quality")
    end
    for slot, other in ipairs(section.filters or {}) do
      local value = other.value
      local item = type(value) == "string" and value or (value and value.name)
      local quality = type(value) == "string" and "normal" or (value and (value.quality or "normal"))
      if (other.index or slot) ~= request.slotIndex and item == request.item and quality == request.quality then
        fail("This item is already requested in another slot")
      end
    end
    local filter = before.request and section.get_slot(request.slotIndex) or {
      value = { type = "item", name = request.item, quality = request.quality },
    }
    if filter.max and filter.max < request.count then fail("Requested minimum exceeds this slot's maximum") end
    filter.min = request.count
    local existing = section.set_slot(request.slotIndex, filter)
    if existing and existing ~= request.slotIndex then fail("This item is already requested in another slot") end
  else
    section.clear_slot(request.slotIndex)
  end
  local after = logistic_snapshot(entity, section, request.slotIndex)
  if request.operation == "logistic_set_request" and not same_request(after.request, { item = request.item, quality = request.quality, count = request.count }) then
    fail("Factorio did not apply the request")
  end
  if request.operation == "logistic_clear_request" and after.request then fail("Factorio did not clear the request") end
  return { operation = request.operation, before = before, after = after }
end

local function logistic_inspect(request)
  local entity = requester(request)
  local point = entity.get_requester_point()
  if not point then fail("Entity has no requester point") end
  local section = point.get_section(request.sectionIndex)
  if not section or not section.valid or not section.is_manual then fail("Request section is unavailable or controlled by the game") end
  local snapshot = logistic_snapshot(entity, section, request.slotIndex)
  return { operation = request.operation, before = snapshot, after = snapshot }
end

local function action(request)
  local operation = request.operation
  if operation == "research_inspect" then return research_inspect(request) end
  if operation == "train_inspect" then return train_inspect(request) end
  if operation == "logistic_inspect" then return logistic_inspect(request) end
  if operation == "research_add" or operation == "research_move"
    or operation == "research_remove" or operation == "research_cancel" then
    return research_action(request)
  end
  if operation == "train_manual" or operation == "train_go_to"
    or operation == "train_add_stop" or operation == "train_update_stop"
    or operation == "train_remove_stop" then return train_action(request) end
  if operation == "logistic_set_request" or operation == "logistic_clear_request" then return logistic_action(request) end
  fail("Unknown factory action")
end
