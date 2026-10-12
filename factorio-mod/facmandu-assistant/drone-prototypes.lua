local util=require('__core__/lualib/util')
local name='toby-drone'
local drone=util.table.deepcopy(data.raw['spider-vehicle'].spidertron)
drone.name=name
drone.icon='__base__/graphics/icons/construction-robot.png'
drone.icon_size=64;drone.icon_mipmaps=nil
drone.minable={mining_time=0.5,result=name}
drone.max_health=200;drone.resistances={}
drone.guns={};drone.allow_passengers=false
drone.inventory_size=20;drone.trash_inventory_size=5
drone.equipment_grid='toby-drone-grid'
drone.selection_box={{-0.6,-0.6},{0.6,0.6}}
drone.collision_box={{-0.2,-0.2},{0.2,0.2}}
drone.height=1;drone.torso_rotation_speed=0.05
drone.corpse=nil;drone.dying_explosion='construction-robot-explosion'
drone.factoriopedia_simulation=nil;drone.working_sound=nil
drone.minimap_representation={filename=drone.icon,size=64,scale=0.25}
drone.selected_minimap_representation=util.table.deepcopy(drone.minimap_representation)
-- A native spider chassis supplies autopilot and an ordinary equipment grid.
-- Its hidden legs only move the drone; construction uses unmodified vanilla robots.
local robot=data.raw['construction-robot']['construction-robot']
drone.graphics_set={animation=util.table.deepcopy(robot.idle),shadow_animation=util.table.deepcopy(robot.shadow_idle),render_layer='air-object'}
local prototypes={drone,
 {type='equipment-grid',name='toby-drone-grid',width=6,height=6,equipment_categories={'armor'}},
 {type='item-with-entity-data',name=name,icon=drone.icon,icon_size=64,subgroup='logistic-network',order='b[construction-robot]-z[toby]',place_result=name,stack_size=1},
 {type='recipe',name=name,enabled=false,energy_required=10,ingredients={{type='item',name='construction-robot',amount=1},{type='item',name='personal-roboport-equipment',amount=1},{type='item',name='processing-unit',amount=10},{type='item',name='steel-plate',amount=10}},results={{type='item',name=name,amount=1}}}
}
for i,entry in ipairs(drone.spider_engine.legs) do
 local leg=util.table.deepcopy(data.raw['spider-leg'][entry.leg])
 leg.name=name..'-leg-'..i;leg.graphics_set={}
 leg.collision_mask={layers={}};leg.walking_sound_volume_modifier=0
 leg.working_sound=nil;leg.target_position_randomisation_distance=0
 entry.leg=leg.name;entry.leg_hit_the_ground_trigger=nil
 prototypes[#prototypes+1]=leg
end
data:extend(prototypes)
data.raw.technology['personal-roboport-equipment'].effects[#data.raw.technology['personal-roboport-equipment'].effects+1]={type='unlock-recipe',recipe=name}
