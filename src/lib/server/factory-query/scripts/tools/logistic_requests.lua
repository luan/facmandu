-- Exact request settings with named-section lookup and resumable detail pages.
local target = require('scripts.tools.target')
local bounded = require('scripts.tools.bounded')
local M = {}
M.manifest = {
 inspect_logistic_requests = {
  desc = 'Read configured logistic requests on a built chest, machine or platform hub. Use group to read a named request section directly, even beyond the first page. Follow next_section_offset and each next_filter_offset until complete; do not ask the player to transcribe omitted settings. A named/indexed section includes cargo slot totals across ALL its filters, independent of detail pagination, native stack sizes and platform cargo-bay capacity. Requests are settings, not deliveries or inventory contents.',
  tier = '2', params = { surface='string! surface name or index',x='number! map x',y='number! map y',name='string entity prototype name',unit_number='integer entity unit number',group='string exact section group name, case-insensitive',section_index='integer exact native section index',section_offset='integer section page offset, default 0',filter_offset='integer filter page offset within each section, default 0',filter_limit='integer filter details per section, default 50, max 50' },
 },
}
local function offset(value)
 if value==nil then return 0 end
 assert(type(value)=='number' and value>=0 and value%1==0,'Page offsets must be nonnegative integers')
 return value
end
local function inspect(a)
 local entity,miss,surface,force=target.find(a)
 if not entity then return miss end
 local sections=entity.get_logistic_sections()
 if not sections then return {found=true,force=force.name,surface=surface.name,name=entity.name,unit_number=entity.unit_number,x=entity.position.x,y=entity.position.y,supports_requests=false,sections={}} end
 if a.group~=nil then assert(type(a.group)=='string' and a.group~='','Use a nonempty section group name') end
 if a.section_index~=nil then assert(type(a.section_index)=='number' and a.section_index>0 and a.section_index%1==0,'Use a positive section index') end
 local start,filter_start=offset(a.section_offset),offset(a.filter_offset)
 local limit=bounded.limit(a.filter_limit,50,50)
 local matched={}
 for _,section in pairs(sections.sections) do
  if (not a.group or (section.group or ''):lower()==a.group:lower()) and (not a.section_index or section.index==a.section_index) then matched[#matched+1]=section end
 end
 table.sort(matched,function(a,b) return a.index<b.index end)
 local rows={}
 for i=start+1,math.min(start+4,#matched) do
  local section=matched[i]
  local filters,amounts={},{}
  for index,filter in pairs(section.filters) do
   local value=filter.value
   if value then
    local item=(value.type==nil or value.type=='item') and prototypes.item[value.name]
    local count=math.ceil(math.max(0,filter.min or 0)*(section.multiplier or 1))
    local quality=value.quality or 'normal'
    local k=value.name..'/'..quality..'/'..(value.comparator or '=')
    if item and count>0 then
     amounts[k]=amounts[k] or {count=0,stack=item.stack_size}
     amounts[k].count=amounts[k].count+count
    end
    filters[#filters+1]={index=filter.index or index,name=value.name,type=value.type,quality=value.quality,comparator=value.comparator,min=filter.min,max=filter.max,stack_size=item and item.stack_size,requested_count=count,import_from=type(filter.import_from)=='string' and filter.import_from or (filter.import_from and filter.import_from.name),request_from=filter.request_from}
   end
  end
  table.sort(filters,function(a,b) return a.index<b.index end)
  local slots=0;for _,item in pairs(amounts) do slots=slots+math.ceil(item.count/item.stack) end
  local page={};for n=filter_start+1,math.min(filter_start+limit,#filters) do page[#page+1]=filters[n] end
  page=bounded.fit(page,10000)
  local shown=filter_start+#page
  rows[#rows+1]={index=section.index,group=section.group,active=section.active,manual=section.is_manual,multiplier=section.multiplier,total_filters=#filters,filters=page,filter_offset=filter_start,next_filter_offset=shown<#filters and shown or nil,truncated=shown<#filters,cargo={requested_slots=slots,complete=true,note='Minimum requests with the section multiplier, combined by item and quality, rounded up to whole native stacks. Includes this section even when inactive.'}}
 end
 local capacity
 if entity.type=='space-platform-hub' then
  local inventory=entity.get_inventory(defines.inventory.hub_main)
  local bay=prototypes.entity['cargo-bay']
  capacity={current_slots=inventory and #inventory,hub_slots=entity.prototype.get_inventory_size(defines.inventory.hub_main,entity.quality),normal_cargo_bay_slots=bay and bay.get_inventory_size_bonus('normal')}
  if capacity.normal_cargo_bay_slots and #matched==1 and rows[1] then
   local slots=rows[1].cargo.requested_slots
   capacity.normal_bays_required=math.ceil(math.max(0,slots-capacity.hub_slots)/capacity.normal_cargo_bay_slots)
   capacity.additional_normal_bays=math.ceil(math.max(0,slots-capacity.current_slots)/capacity.normal_cargo_bay_slots)
  end
 end
 local next_page=start+#rows
 return {found=true,force=force.name,surface=surface.name,name=entity.name,unit_number=entity.unit_number,x=entity.position.x,y=entity.position.y,supports_requests=true,total_sections=sections.sections_count,matching_sections=#matched,shown_sections=#rows,section_offset=start,next_section_offset=next_page<#matched and next_page or nil,truncated=next_page<#matched,sections=rows,cargo_capacity=capacity,request_missing_construction_materials=entity.type=='space-platform-hub' and entity.request_missing_construction_materials or nil}
end
M.functions={inspect_logistic_requests=inspect}
return M
