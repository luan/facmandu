-- Observe delivered output, not buffered inventory. Call with cumulative counts and game ticks.
return function(history,tick,outputs,aggregateItems)
 local totals,order={},{}
 for i,p in ipairs(outputs) do
  local key=p.kind..'/'..p.name..((p.kind=='fluid' or not aggregateItems) and '/'..i or '')
  if not totals[key] then totals[key]={name=p.name,kind=p.kind,rate=0,count=0};order[#order+1]=key end
  local total=totals[key];total.rate=total.rate+p.perMinute;total.count=total.count+p.delivered
 end
 history[#history+1]={tick=tick,totals=totals}
 while history[2] and history[2].tick<=tick-3600 do table.remove(history,1) end
 local first=history[1];local span=tick-first.tick
 local ready=span>=3600 and #order>0
 local rates={}
 for _,key in ipairs(order) do
  local total=totals[key];local previous=assert(first.totals[key],'Trial outputs changed during startup')
  local count=total.count-previous.count
  assert(count>=0,'Trial output counter moved backwards')
  local rate=span>0 and count*3600/span or 0
  local met=span>=3600 and rate>=total.rate*.95
  ready=ready and met
  rates[#rates+1]={name=total.name,kind=total.kind,perMinute=rate,targetPerMinute=total.rate,met=met}
 end
 -- A full buffer can produce one good window before upstream supply catches up.
 -- Keep that rate for another minute before starting the independent measurement.
 if ready then history.readySince=history.readySince or tick else history.readySince=nil end
 return ready and tick-history.readySince>=3600,rates
end
