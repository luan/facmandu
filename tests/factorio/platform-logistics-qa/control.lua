local function record(name, value)
  storage.results[name] = value
  helpers.write_file("platform-logistics-qa.json", helpers.table_to_json(storage.results), false)
  log("PLATFORM_LOGISTICS_QA " .. name .. " " .. helpers.table_to_json {value = value})
end

local function tiles(surface, left, top, right, bottom, name)
  local result = {}
  for x = left, right do
    for y = top, bottom do
      result[#result + 1] = {name = name or "space-platform-foundation", position = {x, y}}
    end
  end
  surface.set_tiles(result, true, false, false, true)
end

local function chest(surface, name, position, force)
  assert(surface.can_place_entity {name = name, position = position, force = force})
  return assert(surface.create_entity {name = name, position = position, force = force})
end

local function request(entity, item, count, quality)
  entity.get_logistic_sections().add_section().set_slot(1, {
    value = {type = "item", name = item, quality = quality or "normal", comparator = "="},
    min = count,
  })
end

local loaded = false
script.on_load(function() loaded = true end)

script.on_init(function()
  game.speed = 100
  storage.results = {}
  game.forces.player.research_all_technologies()
  local platform = assert(game.forces.player.create_space_platform {
    name = "Automatic logistics QA", planet = "nauvis", starter_pack = "space-platform-starter-pack",
  })
  assert(platform.apply_starter_pack())
  platform.paused = true
  storage.platform = platform
  local surface = platform.surface
  surface.freeze_daytime = true
  surface.daytime = 0
  tiles(surface, -16, -16, 80, 16)
  local power = assert(surface.create_entity {name = "electric-energy-interface", position = {0, 10}, force = "player"})
  power.power_production = 1000000000
  power.electric_buffer_size = 1000000000
  storage.power = power
  storage.provider = chest(surface, "passive-provider-chest", {-10.5, 0.5}, "player")
  storage.requester = chest(surface, "requester-chest", {70.5, 0.5}, "player")
  assert(storage.provider.insert {name = "iron-plate", count = 1000} == 1000)
  assert(storage.provider.insert {name = "copper-plate", count = 50, quality = "rare"} == 50)
  request(storage.requester, "iron-plate", 1000)
  storage.rare = chest(surface, "requester-chest", {69.5, 2.5}, "player")
  request(storage.rare, "copper-plate", 50, "rare")
  local ghost = assert(surface.create_entity {name = "entity-ghost", inner_name = "transport-belt", position = {12.5, 2.5}, force = "player"})
  storage.ghost = ghost
  storage.provider.insert {name = "transport-belt", count = 1}
  local other = game.create_force("platform-logistics-other")
  storage.foreign = chest(surface, "requester-chest", {68.5, 4.5}, other)
  request(storage.foreign, "iron-plate", 50)
  local second = assert(other.create_space_platform {
    name = "Separate force QA", planet = "nauvis", starter_pack = "space-platform-starter-pack",
  })
  assert(second.apply_starter_pack())
  storage.second = second
  game.surfaces.nauvis.request_to_generate_chunks({0, 0}, 1)
  game.surfaces.nauvis.force_generate_chunk_requests()
  tiles(game.surfaces.nauvis, -10, -10, 10, 10, "refined-concrete")
  storage.planet = chest(game.surfaces.nauvis, "requester-chest", {0.5, 0.5}, "player")
  storage.stage = "delivery"
  storage.started = game.tick
end)

script.on_nth_tick(30, function()
  if storage.stage == "done" then
    if loaded and not storage.results.save_reload then
      assert(storage.requester.get_item_count("iron-plate") == 1000)
      assert(storage.requester.get_item_count("steel-plate") == 20)
      assert(storage.extended.get_item_count("stone-brick") == 50)
      assert(storage.ghost.valid)
      record("save_reload", true)
    end
    return
  end
  loaded = false
  local ok, message = pcall(function()
    local platform = storage.platform
    local surface = platform.surface
    local elapsed = game.tick - storage.started
    if storage.stage == "delivery" then
      local network = surface.find_logistic_network_by_position(storage.requester.position, "player")
      if network then storage.peak_robots = math.max(storage.peak_robots or 0, network.all_logistic_robots) end
      if storage.requester.get_item_count("iron-plate") == 1000 and storage.rare.get_item_count({name = "copper-plate", quality = "rare"}) == 50 then
        assert(storage.peak_robots > 1, "Robot provision did not scale with demand")
        assert(network.all_construction_robots == 0)
        assert(storage.ghost.valid, "Construction changed")
        assert(not storage.planet.get_logistic_point().logistic_network, "Planet logistics changed")
        assert(storage.provider.get_item_count("iron-plate") == 0)
        assert(storage.foreign.get_item_count("iron-plate") == 0, "Foreign force received items")
        assert(storage.second.surface.count_entities_filtered {type = "logistic-robot"} == 0, "Unpowered platform spawned robots")
        record("delivery_and_quality", {iron = 1000, rareCopper = 50, peakRobots = storage.peak_robots})
        storage.power.power_production = 0
        storage.power.energy = 0
        storage.stage = "blackout"
        storage.started = game.tick
      else
        assert(elapsed < 7200, "Delivery timed out: " .. helpers.table_to_json {
          iron = storage.requester.get_item_count("iron-plate"), robots = network and network.all_logistic_robots,
          ports = surface.count_entities_filtered {name = "platform-logistics-port"},
        })
      end
    elseif storage.stage == "blackout" and elapsed >= 1200 then
      for _, port in pairs(surface.find_entities_filtered {name = "platform-logistics-port"}) do
        assert(not port.logistic_cell.transmitting, "Cell still active without power")
      end
      storage.provider.insert {name = "steel-plate", count = 20}
      request(storage.requester, "steel-plate", 20)
      storage.stage = "unpowered"
      storage.started = game.tick
    elseif storage.stage == "unpowered" and elapsed >= 300 then
      assert(storage.requester.get_item_count("steel-plate") == 0, "Delivery started without power")
      record("blackout", true)
      storage.power.power_production = 1000000000
      storage.stage = "recovery"
      storage.started = game.tick
    elseif storage.stage == "recovery" then
      if storage.requester.get_item_count("steel-plate") == 20 then
        record("power_recovery", true)
        tiles(surface, 81, -2, 170, 2)
        storage.extended = chest(surface, "requester-chest", {168.5, 0.5}, "player")
        storage.provider.insert {name = "stone-brick", count = 50}
        request(storage.extended, "stone-brick", 50)
        storage.stage = "expansion"
        storage.started = game.tick
      else assert(elapsed < 1800, "Power recovery timed out") end
    elseif storage.stage == "expansion" then
      if storage.extended.get_item_count("stone-brick") == 50 then
        record("platform_expansion", true)
        storage.stage = "retirement"
        storage.started = game.tick
      else assert(elapsed < 2400, "Expansion delivery timed out") end
    elseif storage.stage == "retirement" and elapsed >= 1200 then
      local network = surface.find_logistic_network_by_position(storage.requester.position, "player")
      assert(network.all_logistic_robots == 1, "Surplus robots not retired: " .. network.all_logistic_robots)
      assert(network.all_construction_robots == 0)
      assert(storage.ghost.valid)
      record("idle_retirement_and_no_construction", true)
      local port = surface.find_entities_filtered {name = "platform-logistics-port"}[1]
      local p = port.position
      tiles(surface, math.floor(p.x), math.floor(p.y), math.floor(p.x), math.floor(p.y), "empty-space")
      storage.stage = "foundation_removed"
      storage.started = game.tick
    elseif storage.stage == "foundation_removed" and elapsed >= 660 then
      for _, port in pairs(surface.find_entities_filtered {name = "platform-logistics-port"}) do
        assert(surface.get_tile(port.position).prototype.is_foundation, "Cell left above empty space")
      end
      record("foundation_removal", true)
      tiles(surface, 256, 0, 257, 1)
      storage.stage = "empty_chunk"
      storage.started = game.tick
    elseif storage.stage == "empty_chunk" and elapsed >= 660 then
      local port = assert(surface.find_entities_filtered {
        name = "platform-logistics-port", area = {{256, 0}, {258, 2}},
      }[1])
      port.get_inventory(defines.inventory.roboport_robot).insert {
        name = "logistic-robot", quality = "rare", count = 3,
      }
      storage.retiring_port = port
      storage.original_robots = platform.hub.get_item_count {name = "logistic-robot", quality = "rare"}
      storage.hub_fill = platform.hub.insert {name = "iron-plate", count = 1000000}
      tiles(surface, 256, 0, 257, 1, "empty-space")
      storage.stage = "full_hub"
      storage.started = game.tick
    elseif storage.stage == "full_hub" and elapsed >= 660 then
      assert(storage.retiring_port.valid)
      assert(storage.retiring_port.get_inventory(defines.inventory.roboport_robot).get_item_count {
        name = "logistic-robot", quality = "rare",
      } == 3, "Full hub lost player-owned robots")
      assert(platform.hub.remove_item {name = "iron-plate", count = storage.hub_fill} == storage.hub_fill)
      record("full_hub_stock_retained", true)
      storage.stage = "returned_stock"
      storage.started = game.tick
    elseif storage.stage == "returned_stock" and elapsed >= 660 then
      assert(platform.hub.get_item_count {name = "logistic-robot", quality = "rare"} == storage.original_robots + 3)
      record("player_owned_robots_preserved", true)
      local other_surface = storage.second.surface
      game.delete_surface(other_surface)
      record("platform_deletion", true)
      record("passed", true)
      storage.stage = "done"
      game.server_save("platform-logistics-qa-passed")
    end
  end)
  if not ok then
    record("error", tostring(message))
    storage.stage = "done"
    error(message)
  end
end)
