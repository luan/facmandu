import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { lauxlib, lua, lualib, to_luastring } from 'fengari';

test('native planner solver respects supply, recycling balances, output goals and fixed machines', () => {
	const state = lauxlib.luaL_newstate();
	lualib.luaL_openlibs(state);
	const modules = [
		'backend.calculation.simplex_engine',
		'backend.calculation.sequential_engine',
		'backend.calculation.solar',
		'backend.calculation.SimplexTableau',
		'backend.calculation.LUDecomposition',
		'backend.calculation.structures',
		'backend.calculation.solver_util'
	];
	const sources = modules
		.map(
			(name) =>
				`package.preload['planner.${name}']=function() ${readFileSync(`factorio-mod/facmandu-assistant/planner/${name.replaceAll('.', '/')}.lua`, 'utf8')} end`
		)
		.join('\n');
	const status = lauxlib.luaL_dostring(
		state,
		to_luastring(`
 package.preload['__core__.lualib.util']=function() return {split=function(value,separator)
  local parts={};for part in value:gmatch('[^'..separator..']+') do parts[#parts+1]=part end;return parts
 end} end
 ${sources}
 MAGIC_NUMBERS={margin_of_error=1e-6,simplex_tolerance=1e-10,simplex_update_threshold=1e5,simplex_max_factorization_interval=50}
 lib={temperature={name_split=function(name) return name end},is_special_power_item=function() return false end,
  flib={shallow_copy=function(value) local copy={};for k,v in pairs(value) do copy[k]=v end;return copy end}}
 solver={util=require('planner.backend.calculation.solver_util')}
 local engine=require('planner.backend.calculation.simplex_engine')
 local function near(actual,expected)
  assert(actual and math.abs(actual-expected)<1e-5,tostring(actual)..' ~= '..expected)
 end
 local function solve(cap,mode,reclaimed,machines,maximize,target)
  local line={id=1,products={['item/plate']=1},ingredients={['item/ore']=2}}
  if reclaimed then line.products['item/ore']=reclaimed end
  if machines then line.machine_requirement={count=machines} end
  local floor={id=10,level=1,line_ids={1},products={{type='item',name='plate',amount=target or 100000}}}
  if cap then floor.inputs={{type='item',name='ore',amount=cap,mode=mode}} end
  if maximize then floor.maximize_product={type='item',name='plate'} end
  return engine.solve_floor({floor_data_map={[10]=floor},line_data_map={[1]=line}},10)
 end
 for _,supply in ipairs{0,1,7,1000} do
  for _,reclaimed in ipairs{0,0.5} do
   local result=solve(supply,'maximum',reclaimed,nil,true)
   assert(result.status=='solved',result.status)
   local expected=supply/(2-reclaimed)
   near(result.products['item/plate'] or 0,expected)
   near(result.ingredients['item/ore'] or 0,supply)
   near(result.line_result_map[1] and result.line_result_map[1].machine_amount or 0,expected)
  end
 end
 local exact=solve(7,'exact',nil,nil,false,100)
 assert(exact.status=='solved');near(exact.products['item/plate'],3.5)
 local target=solve(nil,nil,nil,nil,false,10)
 assert(target.status=='solved');near(target.products['item/plate'],10);near(target.ingredients['item/ore'],20)
 local fixed=solve(10,'maximum',nil,2,false,100)
 assert(fixed.status=='solved');near(fixed.line_result_map[1].machine_amount,2);near(fixed.ingredients['item/ore'],4)
 assert(solve(1,'maximum',nil,2,false,100).status=='no_solution')

 for _,mode in ipairs{'exact','maximum'} do
  for _,count in ipairs{0,0.5,3,1000} do
   local line={id=1,products={['item/plate']=1},ingredients={['item/ore']=2},machine_constraints={{id=1,count=count,mode=mode,coefficient=1}}}
   local floor={id=10,level=1,line_ids={1},products={{name='plate',type='item',amount=100000}},inputs={{name='ore',type='item',amount=7,mode='maximum'}},maximize_product={name='plate',type='item'}}
   local result=engine.solve_floor({floor_data_map={[10]=floor},line_data_map={[1]=line}},10)
   if mode=='exact' and count>3.5 then assert(result.status=='no_solution')
   else
    assert(result.status=='solved',result.status)
    near(result.products['item/plate'] or 0,math.min(count,3.5))
   end
  end
 end
 -- Independent blocks solve against their own goals instead of a defining-machine unit.
 local block={id=20,level=2,line_ids={1},planning={linked=false},products={{name='plate',type='item',amount=3,mode='exact'}},inputs={{name='ore',type='item',amount=8,mode='maximum'}}}
 local data={floor_data_map={[20]=block},line_data_map={[1]={id=1,products={['item/plate']=1},ingredients={['item/ore']=2}}}}
 local fixed_block=engine.solve_floor(data,20)
 assert(fixed_block.status=='solved');near(fixed_block.products['item/plate'],3);near(fixed_block.ingredients['item/ore'],6)
 data.line_data_map[1].machine_constraints={{id=1,count=5,mode='exact',coefficient=1}}
 assert(engine.solve_floor(data,20).status=='no_solution','Surplus exports cannot bypass an exact block output')
 block.products[1].mode='maximum'
 assert(engine.solve_floor(data,20).status=='no_solution','Surplus exports cannot bypass a block output ceiling')
 data.line_data_map[1].machine_constraints=nil
 block.products[1].mode='exact'
 block.inputs[1].amount=5
 assert(engine.solve_floor(data,20).status=='no_solution','An infeasible child goal must not be silently relaxed')
 block.products={};block.inputs[1].amount=8;block.maximize_product={name='plate',type='item'}
 local forward=engine.solve_floor(data,20)
 assert(forward.status=='solved');near(forward.products['item/plate'],4)
 block.products={{name='missing',type='item',amount=1,mode='exact'}};block.maximize_product=nil
 assert(engine.solve_floor(data,20).status=='no_solution','An exact unavailable output cannot be ignored')
 local solar=require('planner.backend.calculation.solar')
 local sunlight,seconds=solar.profile({ticks_per_day=25000})
 near(sunlight,.7);near(seconds,100)
 near(solar.storage_power(5000000,300000,300000,sunlight,seconds),50000)
 for _,duration in ipairs{10000,25000,50000} do
  local mean,night_seconds=solar.profile({ticks_per_day=duration})
  near(mean,.7);near(night_seconds,duration*.24/60)
  near(solar.storage_power(5000000,300000,300000,mean,night_seconds),math.min(5000000/night_seconds,300000))
 end
 local frozen,frozen_storage=solar.profile({freeze_daytime=true,daytime=.5})
 near(frozen,0);assert(frozen_storage==math.huge)
 near(solar.storage_power(5000000,300000,300000,frozen,frozen_storage),0)
 near(solar.storage_power(5000000,1000,300000,.7,100),1000*.7/.3)
 local sequential=require('planner.backend.calculation.sequential_engine')
 local demand_floor={id=30,level=1,line_ids={1,2},products={{name='plate',type='item',amount=80}}}
 local demand_data={floor_data_map={[30]=demand_floor},line_data_map={
  [1]={id=1,production_type='produce',production_percent=25,products={['item/plate']=1},ingredients={['item/ore']=2}},
  [2]={id=2,production_type='produce',products={['item/plate']=1},ingredients={['item/ore']=2}}}}
 local split=sequential.solve_floor(demand_data,30)
 near(split.line_result_map[1].machine_amount,20);near(split.line_result_map[2].machine_amount,60)
 near(split.products['item/plate'],80);near(split.ingredients['item/ore'],160)
 demand_data.line_data_map[1].production_percent=0
 local off=sequential.solve_floor(demand_data,30)
 near(off.line_result_map[1].machine_amount,0);near(off.line_result_map[2].machine_amount,80)
 local cached_line={id=1,products={['item/plate']=1},ingredients={['item/ore']=2},machine_constraints={{id=1,count=2,mode='maximum',coefficient=1}}}
 local cached_floor={id=10,level=1,line_ids={1},products={{name='plate',type='item',amount=100}},inputs={{name='ore',type='item',amount=7,mode='maximum'}},maximize_product={name='plate',type='item'}}
 local cached_data={floor_data_map={[10]=cached_floor},line_data_map={[1]=cached_line}}
 local first=engine.solve_floor(cached_data,10);near(first.products['item/plate'],2)
 cached_floor.simplex_basis=first.simplex_basis_cache
 cached_line.machine_constraints[1].count=5
 local changed=engine.solve_floor(cached_data,10)
 assert(changed.status=='solved');near(changed.products['item/plate'],3.5);near(changed.ingredients['item/ore'],7)
 for _,cap in ipairs{1,0,12,7,3,100} do
  cached_floor.simplex_basis=changed.simplex_basis_cache
  cached_floor.inputs[1].amount=cap
  changed=engine.solve_floor(cached_data,10)
  assert(changed.status=='solved');near(changed.products['item/plate'] or 0,math.min(5,cap/2))
 end
 for _,count in ipairs{0,.5,2,3.5,5,1} do
  cached_floor.simplex_basis=changed.simplex_basis_cache
  cached_floor.inputs[1].amount=7
  cached_line.machine_constraints[1]={count=count,mode='exact',coefficient=1}
  changed=engine.solve_floor(cached_data,10)
  if count>3.5 then assert(changed.status=='no_solution')
  else assert(changed.status=='solved');near(changed.products['item/plate'] or 0,count) end
 end
 local alternatives={[1]={id=1,products={['item/plate']=1},ingredients={['item/ore']=1}},[2]={id=2,products={['item/plate']=1},ingredients={['item/ore']=2}}}
 local optimization={id=10,level=1,line_ids={1,2},products={{name='plate',type='item',amount=100}},inputs={{name='ore',type='item',amount=10,mode='maximum'}},maximize_product={name='plate',type='item'}}
 local competing={floor_data_map={[10]=optimization},line_data_map=alternatives}
 local original=engine.solve_floor(competing,10);near(original.products['item/plate'],10)
 optimization.simplex_basis=original.simplex_basis_cache
 alternatives[2].products['item/plate']=3
 local improved=engine.solve_floor(competing,10)
 assert(improved.status=='solved');near(improved.products['item/plate'],15);near(improved.ingredients['item/ore'],10)
 optimization.simplex_basis=improved.simplex_basis_cache;optimization.inputs={}
 assert(engine.solve_floor(competing,10).status=='unbounded')
 -- One synthetic floor variable carries independent capacities for two child recipes.
 local synthetic={id=1,products={['item/plate']=1},ingredients={['item/ore']=2},machine_constraints={{id=2,count=7,mode='maximum',coefficient=2},{id=3,count=2,mode='exact',coefficient=1}}}
 local floor={id=10,level=1,line_ids={1},products={{name='plate',type='item',amount=100}},maximize_product={name='plate',type='item'}}
 local combined=engine.solve_floor({floor_data_map={[10]=floor},line_data_map={[1]=synthetic}},10)
 assert(combined.status=='solved','combined '..combined.status);near(combined.products['item/plate'],2)
 synthetic.machine_constraints[1].count=3
 assert(engine.solve_floor({floor_data_map={[10]=floor},line_data_map={[1]=synthetic}},10).status=='no_solution','conflict')
 synthetic.machine_constraints[1].count=7;synthetic.machine_constraints[2].coefficient=0
 assert(engine.solve_floor({floor_data_map={[10]=floor},line_data_map={[1]=synthetic}},10).status=='no_solution','zero impossible')
 synthetic.machine_constraints[2].count=0
 local zero=engine.solve_floor({floor_data_map={[10]=floor},line_data_map={[1]=synthetic}},10);assert(zero.status=='solved','zero redundant '..zero.status)
 assert(solve(nil,nil,nil,nil,true).status=='unbounded')
 `)
	);
	assert.equal(status, lua.LUA_OK, lua.lua_tojsstring(state, -1));
});

test('native books replace a revision and retain independent modules across replay order', () => {
	const state = lauxlib.luaL_newstate();
	lualib.luaL_openlibs(state);
	const source = readFileSync('factorio-mod/facmandu-assistant/planner/books.lua', 'utf8');
	const status = lauxlib.luaL_dostring(
		state,
		to_luastring(`
 package.preload['books']=function() ${source} end
 storage={};game={tick=1}
 local books=require('books')
 local player={force={index=1}}
 local function artifact(id,design,parent,chat)
  return {id=id,designId=design,revisionOf=parent,chatId=chat or 'chat',title='Project',label=id,blueprint='0'..id}
 end
 local function deliver(rows)
  return books.remember(player,{blueprints=rows})
 end
 local a=artifact('a','A');local b=artifact('b','B','A');local c=artifact('c','C','B')
 for _,order in ipairs{{a,b,c},{c,b,a},{a,c,b},{b,a,c},{b,c,a},{c,a,b}} do
  storage={}
  for _,row in ipairs(order) do assert(#deliver{row}.blueprints==1) end
  assert(#books.list(player.force)==1 and books.list(player.force)[1].id=='c')
  assert(#deliver{a,b,c}.blueprints==3)
  assert(#books.list(player.force)==1 and books.list(player.force)[1].id=='c')
  local module=artifact('module','M');assert(#deliver{module}.blueprints==1)
  assert(#books.list(player.force)==2)
  assert(#deliver{artifact('foreign','F','C','other-chat')}.blueprints==0)
  assert(#books.list(player.force)==2 and books.list(player.force)[1].id=='c')
  assert(#deliver{artifact('branch','D','A')}.blueprints==0)
  assert(#deliver{{id='c',designId='C',revisionOf='B',chatId='chat',title='Project',label='c',blueprint='0different'}}.blueprints==0)
 end
 storage={}
 deliver{artifact('legacy',nil)}
 deliver{artifact('legacy','L')}
 deliver{artifact('new','N','L')}
 assert(#books.list(player.force)==1 and books.list(player.force)[1].id=='new')
 -- Metadata-free retries from an older host must keep the learned ancestry.
 assert(#deliver{artifact('legacy',nil)}.blueprints==1)
 assert(books.list(player.force)[1].id=='new')
 storage={}
 deliver{artifact('a',nil)};deliver{c,b};deliver{a}
 assert(#books.list(player.force)==1 and books.list(player.force)[1].id=='c')
 storage={}
 for i=1,65 do assert(#deliver{artifact(tostring(i),'D'..i,i>1 and ('D'..(i-1)) or nil)}.blueprints==1) end
 assert(#deliver{artifact('66','D66','D65')}.blueprints==0)
 assert(#books.list(player.force)==1 and books.list(player.force)[1].id=='65')
 for _,source_newer in ipairs{true,false} do
  storage={};player.force.index=1
  deliver(source_newer and {a,b,c} or {a})
  player.force.index=2
  deliver(source_newer and {a} or {a,b,c})
  books.merge(1,player.force)
  assert(#books.list(player.force)==1 and books.list(player.force)[1].id=='c')
  assert(#deliver{a,b}.blueprints==2)
  assert(#books.list(player.force)==1 and books.list(player.force)[1].id=='c')
 end
 `)
	);
	const error = status === lua.LUA_OK ? '' : lua.lua_tojsstring(state, -1);
	lua.lua_close(state);
	assert.equal(status, lua.LUA_OK, String(error));
});
