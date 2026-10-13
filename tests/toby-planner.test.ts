import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { lauxlib, lua, lualib, to_luastring } from 'fengari';

test('native planner solver respects supply, recycling balances, output goals and fixed machines', () => {
	const state = lauxlib.luaL_newstate();
	lualib.luaL_openlibs(state);
	const modules = [
		'backend.calculation.simplex_engine',
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
