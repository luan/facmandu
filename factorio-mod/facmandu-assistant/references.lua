local M={}
local kinds={item=true,fluid=true,recipe=true,entity=true,technology=true}
function M.prototype(kind,name)
 if not kinds[kind] or type(name)~='string' or #name>100 then return end
 return prototypes[kind][name]
end
function M.add(parent,kind,name,count)
 local prototype=M.prototype(kind,name)
 if not prototype then return end
 local button=parent.add{type='sprite-button',sprite=kind..'/'..name,style='slot_button',number=count,tags={toby_reference=kind,name=name},tooltip={'',prototype.localised_name,'\nAlt-click: ',kind=='technology' and 'Research' or 'Factoriopedia'}}
 return button
end
function M.text(parent,text)
 local seen={};local entries={}
 for kind,name in text:gmatch('%[([%a]+)=([%w_%-]+)%]') do
  local key=kind..'/'..name
  if not seen[key] and M.prototype(kind,name) then seen[key]=true;entries[#entries+1]={kind,name} end
 end
 if #entries==0 then return end
 local row=parent.add{type='table',column_count=8}
 for i=1,math.min(#entries,24) do M.add(row,entries[i][1],entries[i][2]) end
end
function M.click(player,element)
 local tag=element.tags or {}
 if not tag.toby_reference then return false end
 local prototype=M.prototype(tag.toby_reference,tag.name)
 if prototype then
  if tag.toby_reference=='technology' then player.open_technology_gui(player.force.technologies[tag.name])
  else player.open_factoriopedia_gui(prototype) end
 end
 return true
end
return M
