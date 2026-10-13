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
 assert(solve(nil,nil,nil,nil,true).status=='unbounded')
 `)
	);
	assert.equal(status, lua.LUA_OK, lua.lua_tojsstring(state, -1));
});
