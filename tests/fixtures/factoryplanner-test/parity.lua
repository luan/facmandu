-- Public native operations in a disposable full-pack save; never enable on live games.
local events = require('__facmandu-assistant__/events').scope('native-planning-parity-qa')
local function near(actual, expected)
 assert(actual and math.abs(actual-expected)<.001,tostring(actual)..' ~= '..expected)
end
local function run(player)
 player.force.research_all_technologies()
 local force = player.force.name
 local function call(operation, ...) return remote.call('facmandu-toby-planner',operation,force,player.name,...) end
 local function create(name,products,recipes,inputs,maximize)
  return call('create_plan',player.surface.name,name,products,recipes,inputs,maximize)
 end
 local function rate(rows,name)
  for _,row in ipairs(rows) do if row.name==name then return row.perMinute or row.amount end end
  return 0
 end
 local function read(plan) return call('read_plan',plan.planId) end
 local plan = create('Independent block QA',{{name='iron-plate',type='item',perMinute=600}},{{name='iron-plate',machine='stone-furnace'}})
 plan = call('nest_line',plan.planId,plan.revision,plan.lines[1].lineId)
 local block = plan.lines[1].floorId
 local settings = {linked=false,mode='output',products={{name='iron-plate',type='item',perMinute=60,mode='exact'}},inputs={}}
 plan = call('edit_block',plan.planId,plan.revision,block,settings)
 assert(plan.status=='solved',helpers.table_to_json(plan));near(plan.products[1].perMinute,60)
 local ore_per_plate=rate(plan.ingredients,'iron-ore')/60
 assert(ore_per_plate>0)
 local before = helpers.table_to_json(read(plan))
 local bad = table.deepcopy(settings);bad.inputs={{name='iron-ore',type='item',perMinute=-1,mode='maximum'}}
 assert(not pcall(call,'edit_block',plan.planId,plan.revision,block,bad))
 assert(before==helpers.table_to_json(read(plan)),'Rejected block edit mutated the plan')
 assert(not pcall(call,'edit_block',plan.planId,plan.revision-1,block,settings))
 plan = call('set_inputs',plan.planId,plan.revision,{{name='iron-ore',type='item',perMinute=30*ore_per_plate,mode='maximum'}},nil)
 assert(plan.status=='no_solution','Independent quantities were silently scaled to fit a shortage')
 plan = call('set_inputs',plan.planId,plan.revision,{},nil)
 settings.linked=true
 settings.inputs={{name='iron-ore',type='item',perMinute=100*ore_per_plate,mode='maximum'}}
 plan = call('edit_block',plan.planId,plan.revision,block,settings)
 assert(plan.status=='solved',helpers.table_to_json(plan));near(plan.products[1].perMinute,100)
 settings.products={};settings.mode='input';settings.maximize={name='iron-plate',type='item'}
 settings.inputs[1].perMinute=80*ore_per_plate;settings.inputs[1].mode='exact'
 plan = call('edit_block',plan.planId,plan.revision,block,settings)
 assert(plan.status=='solved',helpers.table_to_json(plan));near(plan.products[1].perMinute,80)
 settings.inputs[1].perMinute=10*ore_per_plate;settings.mode='output';settings.maximize=nil
 settings.products={{name='iron-plate',type='item',perMinute=60,mode='exact'}}
 plan = call('edit_block',plan.planId,plan.revision,block,settings)
 assert(plan.status=='no_solution' and plan.blocks[1].status=='no_solution','Infeasible child did not propagate')
 plan = call('edit_block',plan.planId,plan.revision,block,false)
 assert(plan.status=='solved');near(plan.products[1].perMinute,600)
 log('TOBY_BLOCK_OUTPUT_INPUT_LINK_AND_INFEASIBILITY_OK')

 local belt = create('Belt supply QA',{},{{name='iron-plate',machine='stone-furnace'}},
  {{name='iron-ore',type='item',belt='transport-belt',beltCount=.5,beltStack=2,mode='maximum'}},{name='iron-plate',type='item'})
 assert(belt.status=='solved');near(rate(belt.products,'iron-plate'),prototypes.entity['transport-belt'].belt_speed*480*60/ore_per_plate)
 local stored=read(belt);assert(stored.factory.inputs[1].definition.count==.5 and stored.factory.inputs[1].definition.stack==2)
 local output_belt=create('Belt output QA',{{name='iron-plate',type='item',belt='transport-belt',beltCount=.25,beltStack=2}},
  {{name='iron-plate',machine='stone-furnace'}})
 local belt_rate=prototypes.entity['transport-belt'].belt_speed*480*60*.5
 near(rate(output_belt.products,'iron-plate'),belt_rate)
 output_belt=call('set_products',output_belt.planId,output_belt.revision,
  {{name='iron-plate',type='item',belt='transport-belt',beltCount=.125,beltStack=2}})
 near(rate(output_belt.products,'iron-plate'),belt_rate/2)
 output_belt=call('nest_line',output_belt.planId,output_belt.revision,output_belt.lines[1].lineId)
 output_belt=call('edit_block',output_belt.planId,output_belt.revision,output_belt.lines[1].floorId,
  {linked=false,mode='output',inputs={},products={{name='iron-plate',type='item',belt='transport-belt',beltCount=.25,beltStack=2,mode='exact'}}})
 near(rate(output_belt.products,'iron-plate')+rate(output_belt.byproducts,'iron-plate'),belt_rate)
 local machine=create('Machine first QA',{},{{name='iron-plate',machine='stone-furnace',constraint={count=3.5,mode='exact'}}})
 assert(machine.status=='solved');near(machine.lines[1].machines,3.5)
 log('TOBY_INPUT_FIRST_BELTS_AND_MACHINE_FIRST_OK')

 local chain=create('Linked blocks QA',{{name='iron-gear-wheel',type='item',perMinute=20}},
  {{name='iron-gear-wheel',machine='assembling-machine-1'},{name='iron-plate',machine='stone-furnace'}})
 local chain_ore=rate(chain.ingredients,'iron-ore')
 local gear,smelt=chain.lines[1].lineId,chain.lines[2].lineId
 chain=call('nest_line',chain.planId,chain.revision,gear)
 chain=call('nest_line',chain.planId,chain.revision,smelt)
 local gear_floor,smelt_floor
 for _,line in ipairs(chain.lines) do if line.lineId==gear then gear_floor=line.floorId else smelt_floor=line.floorId end end
 chain=call('edit_block',chain.planId,chain.revision,gear_floor,
  {linked=false,mode='output',products={{name='iron-gear-wheel',type='item',perMinute=20,mode='exact'}},inputs={}})
 chain=call('edit_block',chain.planId,chain.revision,smelt_floor,
  {linked=true,mode='input',products={},inputs={{name='iron-ore',type='item',perMinute=chain_ore*1.5,mode='maximum'}},maximize={name='iron-plate',type='item'}})
 assert(chain.status=='solved',helpers.table_to_json(chain));near(chain.products[1].perMinute,20)
 local ore=0;for _,row in ipairs(chain.ingredients) do if row.name=='iron-ore' then ore=ore+row.perMinute end end;near(ore,chain_ore)
 local line_count=#chain.lines
 chain=call('add_line',chain.planId,chain.revision,chain.topFloorId,{name='copper-plate',machine='stone-furnace',constraint={count=1,mode='exact'}})
 assert(#chain.lines==line_count+1 and chain.status=='solved')
 local copper
 for _,line in ipairs(chain.lines) do if line.recipe=='copper-plate' then copper=line.lineId end end
 chain=call('move_line',chain.planId,chain.revision,copper,smelt_floor)
 for _,line in ipairs(chain.lines) do if line.lineId==copper then assert(line.floorId==smelt_floor) end end
 chain=call('remove_line',chain.planId,chain.revision,copper)
 assert(#chain.lines==line_count and chain.status=='solved')
 assert(not pcall(call,'remove_line',chain.planId,chain.revision,smelt),'A defining recipe must stay in its block')
 log('TOBY_LINKED_MATERIAL_BALANCE_AND_LINE_OPERATIONS_OK')
 local powered=create('Power-limited gear QA',{{name='iron-gear-wheel',type='item',perMinute=20}},{{name='iron-gear-wheel',machine='assembling-machine-1'}})
 local watts=rate(powered.ingredients,'custom-electric-power');assert(watts>0)
 powered=call('set_inputs',powered.planId,powered.revision,{{name='custom-electric-power',type='entity',watts=watts/2,mode='maximum'}},{name='iron-gear-wheel',type='item'})
 assert(powered.status=='solved');near(powered.products[1].perMinute,10)
 player.surface.freeze_daytime=false
 local energy=create('Power generation QA',{{name='custom-electric-power',type='entity',watts=1000000}},{{name='impostor-electricity',machine='solar-panel'}})
 assert(energy.status=='solved',helpers.table_to_json(energy));near(energy.products[1].amount,1000000)
 local cycle=player.surface
 local ramp=(cycle.evening-cycle.dusk)+(cycle.dawn-cycle.morning)
 local dark=cycle.morning-cycle.evening
 local sunlight=1-dark-ramp/2
 local expected=1000000/(prototypes.entity['solar-panel'].get_max_energy_production()*60*sunlight*cycle.solar_power_multiplier*cycle.get_property('solar-power')/100)
 near(energy.lines[1].machines,expected)
 local peak=call('edit_line',energy.planId,energy.revision,energy.lines[1].lineId,{powerMode='peak'})
 near(peak.lines[1].machines,expected*sunlight)
 peak=call('edit_line',peak.planId,peak.revision,peak.lines[1].lineId,{quality='uncommon'})
 local quality_ratio=prototypes.entity['solar-panel'].get_max_energy_production('uncommon')/prototypes.entity['solar-panel'].get_max_energy_production('normal')
 near(peak.lines[1].machines,expected*sunlight/quality_ratio)
 local stored=create('Night storage QA',{{name='custom-electric-buffer',type='entity',watts=1000000}},{{name='impostor-electricity-storage',machine='accumulator'}})
 assert(stored.status=='solved',helpers.table_to_json(stored))
 local seconds=(dark+ramp*sunlight/2)*cycle.ticks_per_day/60
 local capacity=prototypes.entity.accumulator.electric_energy_source_prototype.buffer_capacity
 local source=prototypes.entity.accumulator.electric_energy_source_prototype
 local storage_power=math.min(capacity/seconds,source.get_output_flow_limit()*60,source.get_input_flow_limit()*60*sunlight/(1-sunlight))
 near(stored.lines[1].machines,1000000/storage_power)
 local upgraded=call('edit_line',stored.planId,stored.revision,stored.lines[1].lineId,{quality='uncommon'})
 local multiplier=prototypes.entity.accumulator.quality_affects_capacity and prototypes.quality.uncommon.accumulator_capacity_multiplier or 1
 local upgraded_power=math.min(capacity*multiplier/seconds,source.get_output_flow_limit('uncommon')*60,
  source.get_input_flow_limit('uncommon')*60*sunlight/(1-sunlight))
 near(upgraded.lines[1].machines,1000000/upgraded_power)
 local nuclear=create('Reactor heat QA',{{name='custom-heat-power',type='entity',watts=prototypes.entity['nuclear-reactor'].get_max_energy_usage()*60}},{{name='impostor-reactor-heat',machine='nuclear-reactor'}})
 assert(nuclear.status=='solved',helpers.table_to_json(nuclear));near(nuclear.lines[1].machines,1)
 local boosted=call('edit_line',nuclear.planId,nuclear.revision,nuclear.lines[1].lineId,{neighborCount=2})
 near(boosted.lines[1].machines,1/(1+2*prototypes.entity['nuclear-reactor'].neighbour_bonus))
 local cells=rate(nuclear.ingredients,'uranium-fuel-cell')
 near(rate(boosted.ingredients,'uranium-fuel-cell'),cells/(1+2*prototypes.entity['nuclear-reactor'].neighbour_bonus))
 log('TOBY_POWER_SUPPLY_AND_GENERATION_OK')
 local split=create('Manual recipe coverage QA',{{name='iron-plate',type='item',perMinute=80}},{{name='iron-plate',machine='stone-furnace'}})
 local first=split.lines[1].lineId
 split=call('add_line',split.planId,split.revision,read(split).topFloorId,{name='iron-plate',machine='stone-furnace'})
 split=call('set_solver',split.planId,split.revision,split.topFloorId,'sequential',true)
 split=call('edit_line',split.planId,split.revision,first,{productionPercent=25})
 assert(split.lines[1].productionPercentApplied and split.solver=='sequential')
 near(split.lines[1].products[1].perMinute,20);near(split.lines[2].products[1].perMinute,60)
 split=call('set_solver',split.planId,split.revision,split.topFloorId,'simplex')
 assert(not split.lines[1].productionPercentApplied and split.lines[1].productionPercent==25)
 near(split.products[1].perMinute,80)
 assert(not pcall(call,'set_solver',chain.planId,chain.revision,chain.topFloorId,'sequential'))
 local reset=call('edit_line',split.planId,split.revision,first,{productionPercent=false})
 assert(reset.lines[1].productionPercent==nil)
 split=call('edit_line',reset.planId,reset.revision,first,{productionPercent=25})
 reset=call('edit_line',boosted.planId,boosted.revision,boosted.lines[1].lineId,{neighborCount=false})
 assert(reset.lines[1].neighborCount==nil);near(reset.lines[1].machines,1)
 boosted=call('edit_line',reset.planId,reset.revision,reset.lines[1].lineId,{neighborCount=2})
 log('TOBY_SEQUENTIAL_PERCENTAGES_AND_EXPLICIT_SOLVER_SELECTION_OK')
 storage.planner.parity_qa={planId=chain.planId,revision=chain.revision,beltId=belt.planId,blockId=smelt_floor,
  outputBeltId=output_belt.planId,solarId=peak.planId,storageId=upgraded.planId,reactorId=boosted.planId,percentId=split.planId}
 log('TOBY_PLANNING_PARITY_BACKEND_DONE')
end

local checked=false
events.on_nth_tick(5,function()
 if checked or not storage.planner or not storage.planner.players then return end
 local player=game.get_player(1)
 if not player or not lib.globals.player_table(player) then return end
 checked=true
 if storage.planner.parity_qa then
  local saved=storage.planner.parity_qa
  local plan=remote.call('facmandu-toby-planner','read_plan',player.force.name,player.name,saved.planId)
  -- A mod configuration change recalculates plans and advances their revisions.
  assert(plan.revision>=saved.revision and plan.status=='solved')
  near(plan.products[1].perMinute,20)
  local found=false
  for _,block in ipairs(plan.blocks) do if block.floorId==saved.blockId then assert(block.planning.mode=='input' and block.planning.linked);found=true end end
  assert(found)
  local belt=remote.call('facmandu-toby-planner','read_plan',player.force.name,player.name,saved.beltId)
  assert(belt.factory.inputs[1].definition.stack==2)
  local output_belt=remote.call('facmandu-toby-planner','read_plan',player.force.name,player.name,saved.outputBeltId)
  local output_definition=false
  for _,block in ipairs(output_belt.blocks) do
   if block.planning then output_definition=block.planning.products[1].definition.stack==2 end
  end
  assert(output_definition)
  local solar_plan=remote.call('facmandu-toby-planner','read_plan',player.force.name,player.name,saved.solarId)
  assert(solar_plan.lines[1].powerMode=='peak' and solar_plan.lines[1].quality=='uncommon')
  local battery=remote.call('facmandu-toby-planner','read_plan',player.force.name,player.name,saved.storageId)
  assert(battery.lines[1].quality=='uncommon' and battery.products[1].name=='custom-electric-buffer')
  local reactor=remote.call('facmandu-toby-planner','read_plan',player.force.name,player.name,saved.reactorId)
  assert(reactor.lines[1].neighborCount==2)
  local percent=remote.call('facmandu-toby-planner','read_plan',player.force.name,player.name,saved.percentId)
  assert(percent.lines[1].productionPercent==25 and not percent.lines[1].productionPercentApplied)
  log('TOBY_BLOCK_AND_BELT_SAVE_RELOAD_OK')
 else run(player) end
end)

return true
