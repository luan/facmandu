-- Both the web inspector and the drone execute this same native ghost builder.
local blueprint=require('blueprint-engine')
local territories=require('territory')
local range=require('inserter-rules').range
local actions=require('action-engine')
local M={}
function M.run(request)
 if request.player then
  local p=game.get_player(request.player.name)
  assert(p and p.connected and p.force.name==request.force and (not request.player.requireAdmin or p.admin),'Player permission changed; inspect again')
 end
 if request.operation=='entities_edit' then
  local force=assert(game.forces[request.force]);local surface=assert(game.surfaces[request.surface])
  for _,target in ipairs(request.edits)do
   assert(force.is_chunk_charted(surface,{math.floor(target.position.x/32),math.floor(target.position.y/32)}),'Target is outside explored terrain')
   if target.kind=='upgrade' then
    local entity
    for _,candidate in ipairs(surface.find_entities_filtered{position=target.position,force=force,limit=16})do if candidate.unit_number==target.unitNumber then entity=candidate;break end end
    assert(entity,'Upgrade target changed; inspect again')
    local box=entity.bounding_box
    local blocked=territories.blocked(territories.reader(force,surface),box.left_top.x,box.left_top.y,box.right_bottom.x,box.right_bottom.y)
    assert(not blocked,'Upgrade target is in guarded or unverified demolisher territory')
   end
  end
  return actions(request)
 end
 local inventory
 -- blueprint-engine owns a temporary blueprint stack, never a drone inventory.
 local runner=blueprint
 local ok,result=pcall(runner,request,territories,function(value)inventory=value end,range)
 if inventory and inventory.valid then inventory.destroy() end
 if not ok then error(result,0) end
 return result
end
return M
