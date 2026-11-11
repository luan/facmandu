local NAME = "platform-logistics-reader"
local reader = table.deepcopy(data.raw.roboport.roboport)
reader.name = NAME
reader.localised_name = {"entity-name." .. NAME}
reader.localised_description = {"entity-description." .. NAME}
reader.icons = {{icon = "__base__/graphics/icons/roboport.png", tint = {0.5, 0.85, 1}}}
reader.icon = nil
reader.minable = {mining_time = 0.1, result = NAME}
reader.next_upgrade = nil
reader.fast_replaceable_group = nil
reader.collision_box = {{-0.35, -0.35}, {0.35, 0.35}}
reader.selection_box = {{-0.5, -0.5}, {0.5, 0.5}}
reader.surface_conditions = {{property = "gravity", min = 0, max = 0}}
reader.corpse = "constant-combinator-remnants"
reader.dying_explosion = "constant-combinator-explosion"
reader.base = table.deepcopy(data.raw["constant-combinator"]["constant-combinator"].sprites.north)
reader.base_patch = nil
reader.frozen_patch = nil
reader.base_animation = nil
reader.door_animation_up = nil
reader.door_animation_down = nil
reader.recharging_animation = nil
reader.recharging_light = nil
reader.working_sound = nil
reader.open_door_trigger_effect = nil
reader.close_door_trigger_effect = nil
reader.circuit_connector = circuit_connector_definitions["chest"]
reader.circuit_wire_max_distance = default_circuit_wire_max_distance
reader.draw_logistic_radius_visualization = false
reader.draw_construction_radius_visualization = false
reader.logistics_radius = 0
reader.construction_radius = 0
reader.logistics_connection_distance = 64
reader.robot_slots_count = 0
reader.material_slots_count = 0
reader.charging_offsets = nil
reader.charging_station_count = 0
reader.energy_source = {
  type = "electric",
  usage_priority = "secondary-input",
  buffer_capacity = "1kJ",
  input_flow_limit = "10kW",
}
reader.energy_usage = "1kW"
reader.recharge_minimum = "100J"

data:extend {
  reader,
  {
    type = "item",
    name = NAME,
    localised_name = reader.localised_name,
    localised_description = reader.localised_description,
    icons = table.deepcopy(reader.icons),
    subgroup = "circuit-network",
    order = "c[combinators]-z[platform-logistics-reader]",
    place_result = NAME,
    stack_size = 50,
    weight = 10000,
  },
  {
    type = "recipe",
    name = NAME,
    enabled = true,
    ingredients = {
      {type = "item", name = "constant-combinator", amount = 1},
      {type = "item", name = "electronic-circuit", amount = 5},
    },
    results = {{type = "item", name = NAME, amount = 1}},
  },
}
