-- Isolated empty-world fixture; no user save or player progression is loaded.
local blueprint=require('factory-blueprint')
local function record(value)
 helpers.write_file('toby-blueprint-qa.json',helpers.table_to_json(value),false)
 log('TOBY_BLUEPRINT_QA '..helpers.table_to_json(value))
end
script.on_init(function()
 game.speed=10
 local ok,message=pcall(function()
  local design={operation='create',force='player',label='Native path fixture',wires={},tiles={},entities={
   {name='assembling-machine-2',position={x=0.5,y=-2.5},direction=0},
   {name='inserter',position={x=0.5,y=-0.5},direction=0},
   {name='transport-belt',position={x=0.5,y=0.5},direction=4},
   {name='transport-belt',position={x=1.5,y=0.5},direction=8},
   {name='transport-belt',position={x=1.5,y=1.5},direction=4},
   {name='underground-belt',position={x=2.5,y=1.5},direction=4,type='input'},
   {name='underground-belt',position={x=6.5,y=1.5},direction=4,type='output'},
   {name='transport-belt',position={x=7.5,y=1.5},direction=0}
  }}
  local result=blueprint(design)
  local path=result.inserter_transfers[1].planned_belt_path
  assert(path.status=='external' and path.length==6 and path.terminal_entity==8)
  assert(path.next_position.x==7.5 and path.next_position.y==0.5)
  local surface=game.create_surface('toby-blueprint-native',{width=64,height=64})
  surface.request_to_generate_chunks({0,0},1);surface.force_generate_chunk_requests();surface.clear(true)
  local output=assert(surface.create_entity{name='underground-belt',position={14.5,10.5},direction=4,type='output',force='player'})
  assert(surface.create_entity{name='underground-belt',position={10.5,10.5},direction=4,type='input',force='player'})
  local rear=assert(surface.create_entity{name='transport-belt',position={13.5,10.5},direction=4,force='player'})
  local side=assert(surface.create_entity{name='transport-belt',position={14.5,11.5},direction=0,force='player'})
  rear.get_transport_line(1).insert_at_back{name='iron-plate',count=1}
  side.get_transport_line(1).insert_at_back{name='copper-plate',count=1}
  storage.output=output;storage.rear=rear;storage.side=side;storage.path=path
 end)
 if not ok then record{passed=false,error=tostring(message)} end
end)
script.on_nth_tick(120,function()
 if not storage.output then return end
 local rearConnected,sideConnected=false,false
 for _,input in pairs(storage.output.belt_neighbours.inputs) do
  rearConnected=rearConnected or input==storage.rear
  sideConnected=sideConnected or input==storage.side
 end
 local rearArrived=storage.output.get_transport_line(1).get_item_count('iron-plate')+storage.output.get_transport_line(2).get_item_count('iron-plate')>0
 record{passed=not rearConnected and not rearArrived and sideConnected,native=script.active_mods.base,path=storage.path,rearConnected=rearConnected,sideConnected=sideConnected,rearArrived=rearArrived}
 storage.output=nil
end)
