-- Trusted compiler only. Native Lua avoids the interpreter overhead of running
-- pathfinding in JS. Search runs outside Factorio and cannot stall a game tick.
local write=io.write
local hook=debug.sethook
local memory=collectgarbage
os,io,package,debug,load,loadfile,dofile,print=nil,nil,nil,nil,nil,nil,nil,nil
local loaded={}
require=function(name)
 if not loaded[name] then loaded[name]=assert(modules[name],'Unknown compiler module')() end
 return loaded[name]
end
local instructions=0
hook(function()
 instructions=instructions+10000
 if instructions>75000000 or memory('count')>131072 then error('Factory compiler search/memory budget exhausted',0) end
end,'',10000)
local function encode(value,depth)
 assert(depth<20,'Compiler result too deeply nested')
 if type(value)=='string' then
  return '"'..value:gsub('[%z\1-\31\\"]',function(c) return string.format('\\u%04x',string.byte(c)) end)..'"'
 end
 if type(value)=='boolean' then return tostring(value) end
 if type(value)=='number' then
  assert(value==value and math.abs(value)~=math.huge,'Nonfinite compiler value')
  return string.format('%.17g',value)
 end
 assert(type(value)=='table','Compiler returned non-data output')
 local entries={}
 if #value>0 or next(value)==nil then
  for _,entry in ipairs(value) do entries[#entries+1]=encode(entry,depth+1) end
  return '['..table.concat(entries,',')..']'
 end
 local keys={} for key in pairs(value) do keys[#keys+1]=key end table.sort(keys)
 for _,key in ipairs(keys) do entries[#entries+1]=encode(key,depth+1)..':'..encode(value[key],depth+1) end
 return '{'..table.concat(entries,',')..'}'
end
local ok,result=pcall(adapter)
hook()
if ok then write(encode({ok=true,result=result},0))
else write(encode({ok=false,error=tostring(result):sub(1,1000)},0)) end
