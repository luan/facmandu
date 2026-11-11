-- Platform logistics uses normal chests, including those added by other mods.
for _, chest in pairs(data.raw["logistic-container"]) do
  for _, condition in pairs(chest.surface_conditions or {}) do
    if condition.property == "gravity" and condition.min and condition.min > 0 then
      condition.min = 0
    end
  end
end

local port = table.deepcopy(data.raw.roboport.roboport)
port.name = "platform-logistics-port"
port.localised_name = {"entity-name.platform-logistics-port"}
port.flags = {"placeable-off-grid", "not-on-map", "not-blueprintable", "not-deconstructable", "not-flammable"}
port.hidden = true
port.selectable_in_game = false
port.minable = nil
port.next_upgrade = nil
port.fast_replaceable_group = nil
port.collision_box = {{0, 0}, {0, 0}}
port.selection_box = {{0, 0}, {0, 0}}
port.collision_mask = {layers = {}}
port.surface_conditions = nil
port.tile_buildability_rules = nil
port.base = nil
port.base_patch = nil
port.frozen_patch = nil
port.base_animation = nil
port.door_animation_up = nil
port.door_animation_down = nil
port.recharging_animation = nil
port.recharging_light = nil
port.working_sound = nil
port.open_door_trigger_effect = nil
port.close_door_trigger_effect = nil
port.draw_logistic_radius_visualization = false
port.draw_construction_radius_visualization = false
port.render_recharge_icon = false
port.circuit_connector = nil
port.circuit_wire_max_distance = 0
port.logistics_radius = 64
port.logistics_connection_distance = 64
port.construction_radius = 0
port.robot_slots_count = 100
port.material_slots_count = 0
port.energy_source = {
  type = "electric",
  usage_priority = "secondary-input",
  input_flow_limit = "20MW",
  buffer_capacity = "500kJ",
}
port.energy_usage = "50kW"
port.recharge_minimum = "50kJ"
port.charging_energy = "1MW"
port.charging_offsets = nil
port.charging_station_count = 16
port.charging_station_count_affected_by_quality = false

local robot = table.deepcopy(data.raw["logistic-robot"]["logistic-robot"])
robot.name = "platform-logistics-robot"
robot.localised_name = {"entity-name.platform-logistics-robot"}
robot.minable = nil
robot.next_upgrade = nil
robot.factoriopedia_alternative = "logistic-robot"
robot.flags = {"placeable-off-grid", "not-on-map", "not-blueprintable", "not-deconstructable"}

local item = table.deepcopy(data.raw.item["logistic-robot"])
item.name = robot.name
item.place_result = robot.name
item.localised_name = robot.localised_name
item.hidden = true
item.hidden_in_factoriopedia = true
item.spoil_ticks = nil
item.spoil_result = nil

data:extend {port, robot, item}
