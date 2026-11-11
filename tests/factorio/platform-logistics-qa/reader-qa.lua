local M = {}
local RED = defines.wire_connector_id.circuit_red
local GREEN = defines.wire_connector_id.circuit_green

function M.setup(platform)
  local surface, force = platform.surface, platform.force
  local function create(name, position)
    assert(surface.can_place_entity {name = name, position = position, force = force})
    return assert(surface.create_entity {name = name, position = position, force = force})
  end
  assert(force.recipes["platform-logistics-reader"].enabled)
  assert(not game.surfaces.nauvis.can_place_entity {
    name = "platform-logistics-reader", position = {4.5, 4.5}, force = force,
  })
  local reader = create("platform-logistics-reader", {8.5, 6.5})
  local robots = create("platform-logistics-reader", {10.5, 6.5})
  local probe = create("constant-combinator", {9.5, 9.5})
  local stock = create("storage-chest", {14.5, -5.5})
  assert(stock.insert {name = "iron-stick", count = 43} == 43)
  assert(stock.insert {name = "iron-stick", quality = "rare", count = 7} == 7)
  local contents = reader.get_or_create_control_behavior()
  contents.read_items_mode = defines.control_behavior.roboport.read_items_mode.logistics
  contents.read_robot_stats = false
  local stats = robots.get_or_create_control_behavior()
  stats.read_items_mode = defines.control_behavior.roboport.read_items_mode.none
  stats.read_robot_stats = true
  stats.available_logistic_output_signal = {type = "virtual", name = "signal-A"}
  stats.total_logistic_output_signal = {type = "virtual", name = "signal-T"}
  assert(reader.get_wire_connector(RED, true).connect_to(probe.get_wire_connector(RED, true)))
  assert(robots.get_wire_connector(GREEN, true).connect_to(probe.get_wire_connector(GREEN, true)))
  storage.reader_qa = {reader = reader, robots = robots, probe = probe, stock = stock}
end

function M.check(expected)
  local state = storage.reader_qa
  local network = state.reader.logistic_cell.logistic_network
  assert(network and network == state.robots.logistic_cell.logistic_network, "Reader did not join the platform network")
  local probe = state.probe
  assert(probe.get_signal({type = "item", name = "iron-stick", quality = "normal"}, RED) == expected, "Red wire stock mismatch")
  assert(probe.get_signal({type = "item", name = "iron-stick", quality = "rare"}, RED) == 7, "Red wire lost item quality")
  assert(probe.get_signal({type = "virtual", name = "signal-A"}, GREEN) == network.available_logistic_robots, "Available robot count mismatch")
  assert(probe.get_signal({type = "virtual", name = "signal-T"}, GREEN) == network.all_logistic_robots, "Total robot count mismatch")
  assert(probe.get_signal({type = "item", name = "iron-stick"}, GREEN) == 0, "Independent reader controls changed")
  assert(probe.get_signal({type = "virtual", name = "signal-T"}, RED) == 0, "Red and green circuits mixed")
end

function M.blueprint(platform)
  local inventory = game.create_inventory(1)
  local blueprint = inventory[1]
  blueprint.set_stack {name = "blueprint"}
  blueprint.create_blueprint {
    surface = platform.surface, force = platform.force, area = {{9.01, 6.01}, {10.99, 9.99}},
  }
  local ghosts = blueprint.build_blueprint {
    surface = platform.surface, force = platform.force, position = {40, 10},
    build_mode = defines.build_mode.forced,
  }
  assert(#ghosts == 2, helpers.table_to_json(blueprint.get_blueprint_entities()))
  local copies, built = {}
  for _, ghost in pairs(ghosts) do
    local _, entity = ghost.revive()
    assert(entity)
    copies[#copies + 1] = entity
    if entity.name == "platform-logistics-reader" then built = entity end
  end
  assert(built and built.name == "platform-logistics-reader")
  local behavior = built.get_or_create_control_behavior()
  assert(behavior.read_items_mode == defines.control_behavior.roboport.read_items_mode.none)
  assert(behavior.read_robot_stats and behavior.total_logistic_output_signal.name == "signal-T")
  assert(built.get_wire_connector(GREEN, false).connection_count == 1)
  built.copy_settings(storage.reader_qa.reader)
  assert(behavior.read_items_mode == defines.control_behavior.roboport.read_items_mode.logistics)
  assert(not behavior.read_robot_stats)
  for _, copy in pairs(copies) do copy.destroy() end
  inventory.destroy()
end

return M
