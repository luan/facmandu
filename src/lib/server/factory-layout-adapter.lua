local engine = require('engine.init')
local fraction = engine.fraction
local solved, errors = engine.solve(problem, pack)
if not solved then
 local messages = {}
 for _,issue in ipairs(errors) do messages[#messages+1]=issue.code..': '..issue.message..' ('..(issue.hint or '')..')' end
 error(table.concat(messages,'; '),0)
end
if solved.scale then error('Compiler cannot meet the requested rate in this area; target was not reduced',0) end
if not solved.report.ok then error('Compiler connectivity validation failed',0) end
if not solved.power or solved.power.unpowered>0 or solved.power.split then error('Compiler could not power the complete factory block',0) end
local function number(value) return fraction.is(value) and value.n/value.d or value end
local inputs, steps, ports = {}, {}, {}
for _,row in ipairs(solved.plan.inputs) do
 local needed=number(row.rate)*60
 local available=0
 for _,port in ipairs(problem.inputs) do if port.item==row.item then available=available+port.perMinute end end
 if needed>available+0.00001 then error('Insufficient declared supply: '..row.item..' needs '..needed..'/min, available '..available..'/min',0) end
 inputs[#inputs+1]={item=row.item,perMinute=needed}
end
for _,row in ipairs(solved.plan.steps) do
 local count=0
 for _,e in ipairs(solved.blueprint.blueprint.entities) do if e.recipe==row.recipe then count=count+1 end end
 steps[#steps+1]={recipe=row.recipe,machines=count,perMinute=number(row.rate)*60}
end
local entities, wires={},{ }
for _,entity in ipairs(solved.blueprint.blueprint.entities) do
 local port=entity.name==engine.blueprint.INPUT_PORT or entity.name==engine.blueprint.OUTPUT_PORT
 local row={name=port and problem.tiers.belt or entity.name,position=entity.position,direction=entity.direction or 0,recipe=entity.recipe,type=entity.type}
 if pack.furnaces[row.name] then row.recipe=nil end
 entities[#entities+1]=row
 if port then ports[#ports+1]={entity=#entities,item=entity.tags.interpose_item,kind=entity.name==engine.blueprint.INPUT_PORT and 'input' or 'output',position=entity.position} end
end
for _,pole in ipairs(solved.power.poles) do entities[#entities+1]={name=pole.name,position=pole.position} end
local poles={}
for i,e in ipairs(entities) do if pack.poles[e.name] then poles[e.position.x..','..e.position.y]=i end end
for _,wire in ipairs(solved.power.wires) do
 local a,b=wire[1],wire[2]
 local from,to=poles[a.x..','..a.y],poles[b.x..','..b.y]
 if not from or not to then error('Compiler returned an incomplete power connection',0) end
 wires[#wires+1]={from,5,to,5}
end
return {entities=entities,wires=wires,inputs=inputs,steps=steps,ports=ports,warnings=solved.warnings or {}}
