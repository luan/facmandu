local function before(a,b) return a.f<b.f or (a.f==b.f and a.h<b.h) end
local function push(heap,node)
 local i=#heap+1
 while i>1 do local parent=math.floor(i/2);if not before(node,heap[parent]) then break end;heap[i]=heap[parent];i=parent end
 heap[i]=node
end
local function pop(heap)
 local result,last=heap[1],table.remove(heap)
 if #heap>0 then
  local i=1
  while i*2<=#heap do
   local child=i*2
   if child<#heap and before(heap[child+1],heap[child]) then child=child+1 end
   if not before(heap[child],last) then break end
   heap[i]=heap[child];i=child
  end
  heap[i]=last
 end
 return result
end
return {push=push,pop=pop}
