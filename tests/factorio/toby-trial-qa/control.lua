-- Empty-world native acceptance: real belts, crafting, fluids, power and isolation.
local function record(ok,message)
 local proof={passed=ok,error=message,results=storage.results,version=script.active_mods['facmandu-assistant']}
 helpers.write_file('toby-trial-qa.json',helpers.table_to_json(proof),false)
 log('TOBY_TRIAL_QA '..helpers.table_to_json(proof))
end
local function blueprint(rows)
 local inv=game.create_inventory(1);local s=inv[1];s.set_stack{name='blueprint'}
 for i,e in ipairs(rows) do e.entity_number=i end
 s.set_blueprint_entities(rows,false)
 local value=s.export_stack();inv.destroy();return value
end
local function endpoint(index,name,rate,kind)
 return {entity=index,name=name,kind=kind or 'item',perMinute=rate}
end
local function start_next()
 storage.case=storage.case+1
 local case=storage.cases[storage.case]
 if not case then
  assert(storage.sentinel.valid and storage.sentinel.get_inventory(defines.inventory.chest).get_item_count('iron-plate')==37,'Real inventory changed')
  assert(game.surfaces.nauvis.count_entities_filtered{force='player',type='assembling-machine'}==0,'Trial entities leaked')
  assert(not pcall(remote.call,'facmandu-toby-sandbox','read','other',storage.last),'Another force read the trial')
  assert(remote.call('facmandu-toby-sandbox','start',storage.lastRequest).id==storage.last,'Completed delivery replay ran again')
  local request=storage.lastRequest
  request.idempotencyKey=string.rep('de',32)
  local pending=remote.call('facmandu-toby-sandbox','start',request)
  assert(remote.call('facmandu-toby-sandbox','cancel','player',pending.id).status=='cancelled','Cancellation failed')
  request.idempotencyKey=string.rep('fe',32);request.outputs[1].entity=request.inputs[1].entity
  assert(not pcall(remote.call,'facmandu-toby-sandbox','start',request),'Shared input/output faked delivery')
  storage.verifyAt=game.tick+60;return
 end
 local a={force='player',surface=case.context and 'toby-qa-context' or 'nauvis',context=case.context,position={x=0,y=0},blueprint=blueprint(case.entities),designId=string.rep('a',64),idempotencyKey=string.rep(string.format('%x',storage.case),64),seconds=10,warmupSeconds=5,
  inputs=case.inputs,outputs=case.outputs,power=case.power or 'provided',robots=case.robots,mode=case.robots and 'robot-deployment' or ((case.inputs[1].name==case.outputs[1].name) and 'transport' or 'production')}
 if case.context then
  local ok,err=pcall(remote.call,'facmandu-toby-sandbox','start',a)
  assert(not ok and tostring(err):find('Explore context chunk',1,true),'Uncharted context was not rejected')
  storage.results[#storage.results+1]={name='uncharted context rejected',result={passed=false,status='rejected'}}
  start_next();return
 end
 storage.lastRequest=a
 local started=remote.call('facmandu-toby-sandbox','start',a)
 assert(started.status=='running')
 assert(remote.call('facmandu-toby-sandbox','start',a).id==started.id,'Running delivery replay ran again')
 storage.current=started.id;storage.last=started.id
end
script.on_init(function()
 local ok,err=pcall(function()
  local sentinel=game.surfaces.nauvis.create_entity{name='steel-chest',position={100.5,100.5},force='player'}
  assert(sentinel);sentinel.insert{name='iron-plate',count=37};storage.sentinel=sentinel
  game.create_force('other')
  for _,name in ipairs{'inserter','fast-inserter','steel-chest','assembling-machine-1','pipe','roboport','logistic-robot','construction-robot','constant-combinator','decider-combinator','passive-provider-chest'} do game.forces.player.recipes[name].enabled=true end
  local belts={} for x=0,5 do belts[#belts+1]={name='transport-belt',position={x+.5,.5},direction=4} end
  local broken=helpers.json_to_table(helpers.table_to_json(belts));broken[3].direction=12
  local craft={
   {name='steel-chest',position={.5,.5}},
   {name='fast-inserter',position={1.5,.5},direction=12,use_filters=true,filters={{index=1,name='iron-plate'}}},
   {name='assembling-machine-1',position={3.5,.5},recipe='iron-gear-wheel'},
   {name='fast-inserter',position={5.5,.5},direction=12},
   {name='steel-chest',position={6.5,.5}}
  }
  local slow=helpers.json_to_table(helpers.table_to_json(craft));slow[2].name='inserter'
  local filtered=helpers.json_to_table(helpers.table_to_json(craft));filtered[2].filters[1].name='copper-plate'
  local circuit=helpers.json_to_table(helpers.table_to_json(craft))
  circuit[2].control_behavior={circuit_enabled=true,circuit_condition={first_signal={type='item',name='iron-plate'},comparator='>',constant=500}}
  circuit[2].wires={{2,defines.wire_connector_id.circuit_red,1,defines.wire_connector_id.circuit_red}}
  local context=game.create_surface('toby-qa-context',{width=64,height=64,default_enable_all_autoplace_controls=false})
  context.generate_with_lab_tiles=true;context.request_to_generate_chunks({0,0},1);context.force_generate_chunk_requests()
  game.forces.player.chart(context,{{-32,-32},{32,32}})
  for x=0,1 do assert(context.create_entity{name='transport-belt',position={x+.5,.5},direction=4,force='player'}) end
  local ironIn=endpoint(1,'iron-plate',450);ironIn.lane=1
  local copperIn=endpoint(1,'copper-plate',450);copperIn.lane=2
  local ironOut=endpoint(6,'iron-plate',450);ironOut.lane=1
  local copperOut=endpoint(6,'copper-plate',450);copperOut.lane=2

  local robot={
   {name='roboport',position={0,0},control_behavior={read_items_mode=0,read_robot_stats=true},wires={{1,1,2,1},{1,1,3,1}}},
   {name='decider-combinator',position={-2.5,-2},control_behavior={decider_conditions={conditions={{first_signal={type='virtual',name='signal-X'},comparator='<',constant=2},{first_signal={type='virtual',name='signal-Y'},comparator='<',constant=10,compare_type='and'}},outputs={{signal={type='virtual',name='signal-L'},copy_count_from_input=false,constant=1}}}},wires={{2,3,4,1}}},
   {name='decider-combinator',position={2.5,-2},control_behavior={decider_conditions={conditions={{first_signal={type='virtual',name='signal-Z'},comparator='<',constant=3},{first_signal={type='virtual',name='signal-T'},comparator='<',constant=10,compare_type='and'}},outputs={{signal={type='virtual',name='signal-C'},copy_count_from_input=false,constant=1}}}},wires={{3,3,5,1}}},
   {name='fast-inserter',position={-2.5,.5},direction=12,override_stack_size=1,control_behavior={circuit_enabled=true,circuit_condition={first_signal={type='virtual',name='signal-L'},comparator='>',constant=0}}},
   {name='fast-inserter',position={2.5,.5},direction=4,override_stack_size=1,control_behavior={circuit_enabled=true,circuit_condition={first_signal={type='virtual',name='signal-C'},comparator='>',constant=0}}},
   {name='passive-provider-chest',position={-3.5,.5}},
   {name='passive-provider-chest',position={3.5,.5}}
  }
  local disabled=helpers.json_to_table(helpers.table_to_json(robot));disabled[4].control_behavior.circuit_enabled=false;disabled[5].control_behavior.circuit_enabled=false
  local uncapped=helpers.json_to_table(helpers.table_to_json(robot));table.remove(uncapped[2].control_behavior.decider_conditions.conditions,2);table.remove(uncapped[3].control_behavior.decider_conditions.conditions,2)
  local robotTargets={port=1,logistic={minimumIdle=2,maximumTotal=10},construction={minimumIdle=3,maximumTotal=10}}
  local robotInputs={endpoint(6,'logistic-robot',1000),endpoint(7,'construction-robot',1000)}
  local providerCraft=helpers.json_to_table(helpers.table_to_json(craft));providerCraft[1].name='passive-provider-chest';providerCraft[5].name='passive-provider-chest'

  storage.cases={
   {name='robot idle reserve and population cap',entities=robot,inputs=robotInputs,outputs={},robots=robotTargets,pass=true},
   {name='disabled robot inserter circuits',entities=disabled,inputs=robotInputs,outputs={},robots=robotTargets,pass=false},
   {name='missing robot population cap',entities=uncapped,inputs=robotInputs,outputs={},robots=robotTargets,pass=false},
   {name='logistic chest test endpoints',entities=providerCraft,inputs={endpoint(1,'iron-plate',120)},outputs={endpoint(5,'iron-gear-wheel',45)},pass=true},
   {name='mixed belt lanes',entities=belts,inputs={ironIn,copperIn},outputs={ironOut,copperOut},pass=true},
   {name='connected belt',entities=belts,inputs={endpoint(1,'iron-plate',900)},outputs={endpoint(6,'iron-plate',900)},pass=true},
   {name='reversed ingredient belt',entities=broken,inputs={endpoint(1,'iron-plate',900)},outputs={endpoint(6,'iron-plate',900)},pass=false},
   {name='filtered ingredient insertion and crafting',entities=craft,inputs={endpoint(1,'iron-plate',120)},outputs={endpoint(5,'iron-gear-wheel',45)},pass=true},
   {name='slow ingredient inserter limits output',entities=slow,inputs={endpoint(1,'iron-plate',120)},outputs={endpoint(5,'iron-gear-wheel',45)},pass=false},
   {name='native filters are preserved',entities=filtered,inputs={endpoint(1,'iron-plate',120)},outputs={endpoint(5,'iron-gear-wheel',45)},pass=false},
   {name='native circuit condition and wire are preserved',entities=circuit,inputs={endpoint(1,'iron-plate',120)},outputs={endpoint(5,'iron-gear-wheel',45)},pass=false},
   {name='missing power is detected',entities=craft,inputs={endpoint(1,'iron-plate',120)},outputs={endpoint(5,'iron-gear-wheel',45)},power='design',pass=false},
   {name='connected fluid delivery',entities={{name='pipe',position={.5,.5}},{name='pipe',position={1.5,.5}},{name='pipe',position={2.5,.5}}},inputs={endpoint(1,'water',600,'fluid')},outputs={endpoint(3,'water',600,'fluid')},pass=true},
   {name='low-rate source credit',entities=belts,inputs={endpoint(1,'iron-plate',12)},outputs={endpoint(6,'iron-plate',900)},pass=false},
   {name='cloned existing supply context',entities=belts,inputs={endpoint(1,'iron-plate',900)},outputs={endpoint(6,'iron-plate',900)},context=true,pass=true}
  }
  storage.results={};storage.case=0;start_next()
 end)
 if not ok then record(false,tostring(err)) end
end)
script.on_nth_tick(30,function()
 if storage.verifyAt and game.tick>=storage.verifyAt then
  storage.verifyAt=nil
  local ok,err=pcall(function()
   for _,s in pairs(game.surfaces) do assert(not s.name:match('^toby%-trial%-'),'Completed, cancelled or rejected lab leaked') end
  end)
  record(ok,not ok and tostring(err) or nil)
 end
 if not storage.current then return end
 local ok,err=pcall(function()
  local result=remote.call('facmandu-toby-sandbox','read','player',storage.current)
  if result.status=='running' then return end
  local case=storage.cases[storage.case]
  storage.results[#storage.results+1]={name=case.name,result=result}
  assert(result.status=='done',case.name..': '..tostring(result.error))
  assert(result.passed==case.pass,case.name..': wrong pass/fail '..helpers.table_to_json(result))
  if case.name=='low-rate source credit' then assert(result.inputs[1].supplied>0,'Low-rate supply never accumulated a whole item') end
  storage.current=nil;start_next()
 end)
 if not ok then storage.current=nil;record(false,tostring(err)) end
end)
