-- Manual planner-to-layout workspace. Search runs on the host, never in a game tick.
local events=require('events').scope('layout')
local books=require('planner.books')
local M={}
local PREFIX='toby-layout-'
local shapes={'auto','wide','tall','square'}
local spacings={'compact','spacious'}
local transport_modes={inputs={'belts','requester-chests'},intermediates={'belts','buffer-chests'},outputs={'belts','storage-chests'}}
local VIEW_VERSION=2
local function uses_robots(r)
 return r.inputs.selected_index==2 or r.intermediates.selected_index==2 or r.outputs.selected_index==2
end
local function state()
 storage.layouts=storage.layouts or {forces={},viewers={},sequence=0}
 return storage.layouts
end
local function plan_for(player,id)
 return remote.call('facmandu-toby-planner','read_plan',player.force.name,player.name,id)
end
local function workspace(player,id)
 local s=state();s.forces[player.force.index]=s.forces[player.force.index] or {}
 local force=s.forces[player.force.index]
 if not force[id] then
  local count=0;for _ in pairs(force) do count=count+1 end
  assert(count<32,'This force already has 32 layout workspaces')
  force[id]={id=id,force=player.force.index,settings={width=100,height=100,layout={shape='auto',spacing='compact'},
   tiers={belt='transport-belt',underground='underground-belt',splitter='splitter',inserter='inserter',pole='medium-electric-pole',pipe='pipe',pipe_underground='pipe-to-ground'},
   transport={inputs='requester-chests',intermediates='belts',outputs='storage-chests'},requestSeconds=30,outputSlots=4},status='idle'}
 end
 local w=force[id]
 if type(w.settings.transport)~='table' then
  local robots=w.settings.transport=='robots'
  w.settings.transport={inputs=robots and 'requester-chests' or 'belts',intermediates=robots and 'buffer-chests' or 'belts',outputs=robots and 'storage-chests' or 'belts'}
  -- The new buffer mode has different chest settings; the old preview needs regeneration.
  w.blueprintRevision=nil
 end
 return w
end
local function current(player)
 local v=state().viewers[player.index]
 if v and v.force==player.force.index then return workspace(player,v.id),v end
end
local function text(parent,caption,width,style)
 local e=parent.add{type='label',caption=caption,style=style or 'label'}
 e.style.single_line=false;e.style.width=width
 return e
end
local function tagged(action) return {toby_layout=action} end
local function close(player,back)
 local _,v=current(player)
 local frame=player.gui.screen[PREFIX..'frame'];if frame then if back then frame.visible=false else frame.destroy() end end
 if v and not back then v.refs=nil end
 if back and v then remote.call('facmandu-toby-planner','open_plan',player.force.name,player.name,v.id) end
end
local function fresh(player,w)
 local ok,p=pcall(remote.call,'facmandu-toby-planner','plan_status',player.force.name,player.name,w.id)
 return ok and p.revision==w.revision and p.status=='solved' and p.valid
end
local function visible_error(message)
 if type(message)~='string' then return message end
 if message:sub(1,1)=='[' then
  local ok,issues=pcall(helpers.json_to_table,message)
  if ok and type(issues)=='table' then
   local descriptions={};for _,issue in ipairs(issues) do if type(issue.message)=='string' then descriptions[#descriptions+1]=issue.message end end
   if #descriptions>0 then return table.concat(descriptions,' · ') end
  end
 end
 return message
end
local function refresh(player)
 local w,v=current(player);local r=v and v.refs
 if not v or v.version~=VIEW_VERSION or not r or not r.frame.valid or not r.status or not r.status.valid then return end
 local ready=w.status=='ready' and w.blueprint and w.blueprintRevision==w.revision and fresh(player,w)
 local dirty=v.dirty
 local elapsed=math.floor((game.tick-(w.started or game.tick))/60)
 local status=visible_error(v.error or w.error) or (w.status=='queued' and (elapsed>15 and 'Waiting for the Facmandu layout service…' or 'Queued…'))
  or (w.status=='compiling' and 'Laying out the saved plan…') or (ready and 'Blueprint ready') or 'Configure the layout, then generate a blueprint.'
 if w.status=='ready' and w.blueprint and not ready then status='Plan changed · Generate a new layout' end
 if dirty then status='Settings changed · Generate to update the preview' end
 if v.error then status=visible_error(v.error) end
 r.robots.visible=uses_robots(r)
 r.status.caption=status;r.elapsed.caption=(w.status=='queued' or w.status=='compiling') and (elapsed..'s') or ''
 r.generate.enabled=w.status~='queued' and w.status~='compiling'
 r.take.enabled=not not (ready and not dirty);r.inspect.enabled=r.take.enabled
 r.cancel.visible=w.status=='queued' or w.status=='compiling'
 r.summary.caption=w.blueprint and ('Revision '..w.revision..' · '..(w.entityCount or 0)..' entities') or 'No blueprint yet'
 if w.surface and game.surfaces[w.surface] and r.surface~=w.surface then
  r.camera.surface_index=game.surfaces[w.surface].index;r.camera.position=w.center;r.camera.zoom=w.zoom
  r.camera.visible=true;r.empty.visible=false;r.surface=w.surface
 end
end
local function numeric(parent,name,value,width)
 local e=parent.add{type='textfield',text=tostring(value),numeric=true,allow_decimal=false,allow_negative=false,tags=tagged('dirty')}
 e.name=PREFIX..name;e.style.width=width or 70;return e
end
local function choice(parent,caption,items,index)
 text(parent,caption,124)
 local e=parent.add{type='drop-down',items=items,selected_index=index,tags=tagged('dirty')};e.style.width=156;return e
end
local function selector(parent,caption,value,kind)
 text(parent,caption,124)
 return parent.add{type='choose-elem-button',elem_type='entity',entity=value,
  elem_filters={{filter='type',type=kind}},tags=tagged('dirty')}
end
local function index_of(values,value) for i,v in ipairs(values) do if v==value then return i end end;return 1 end
function M.open(index,id)
 local player=assert(game.get_player(index),'Player not found')
 local plan=plan_for(player,id);local w=workspace(player,id);local s=state()
 local old=s.viewers[player.index]
 local main=player.gui.screen.toby_planner_frame_main_dialog;if main then main.visible=false end
 -- Reopening does not reset local unsubmitted settings or keyboard focus.
 if old and old.version==VIEW_VERSION and old.id==id and old.force==player.force.index and old.refs and old.refs.frame.valid then
  old.refs.frame.visible=true;player.opened=old.refs.frame;refresh(player);return true
 end
 close(player)
 local width=math.floor(math.max(700,math.min(1200,player.display_resolution.width/player.display_scale-60)))
 local height=math.floor(math.max(480,math.min(850,player.display_resolution.height/player.display_scale-80)))
 local frame=player.gui.screen.add{type='frame',name=PREFIX..'frame',direction='vertical',tags=tagged('close')}
 frame.style.width=width;frame.style.height=height
 local header=frame.add{type='flow',direction='horizontal',style='frame_header_flow'};header.drag_target=frame
 header.add{type='label',caption='Layout · '..plan.name,style='toby_planner_label_frame_title',ignored_by_interaction=true}
 local drag=header.add{type='empty-widget',style='toby_flib_titlebar_drag_handle',ignored_by_interaction=true};drag.drag_target=frame
 header.add{type='sprite-button',sprite='utility/close',style='toby_planner_button_frame',tags=tagged('close'),tooltip='Back to plan'}
 local nav=frame.add{type='flow',direction='horizontal'}
 nav.add{type='button',caption='← Production plan',style='toby_planner_button_frame_tool',tags=tagged('back')}
 text(nav,'Machines and rates come from the saved plan.',width-240)
 local body=frame.add{type='flow',direction='horizontal'};body.style.vertically_stretchable=true;body.style.horizontal_spacing=12
 local left=body.add{type='scroll-pane',direction='vertical',horizontal_scroll_policy='never'};left.style.width=320;left.style.vertically_stretchable=true
 local r={frame=frame};s.viewers[player.index]={version=VIEW_VERSION,force=player.force.index,id=id,refs=r,dirty=false}
 local settings=w.settings
 text(left,'Targets / min',280,'bold_label')
 local targets=left.add{type='table',column_count=2}
 for _,product in ipairs(plan.products) do if product.type~='entity' and product.perMinute and product.perMinute>0 then
  local proto=prototypes[product.type][product.name]
  targets.add{type='sprite-button',sprite=product.type..'/'..product.name,style='slot_button',tooltip=proto.localised_name,tags={toby_layout='pedia',kind=product.type,prototype=product.name}}
  text(targets,{'',string.format('%.2f',product.perMinute),' × ',proto.localised_name},228)
 end end
 text(left,'Machines',280,'bold_label')
 local list=left.add{type='table',column_count=2}
 local unlocked={}
 for _,recipe in pairs(player.force.recipes) do if recipe.enabled then
  for _,product in pairs(recipe.products) do if product.type=='item' then unlocked[product.name]=true end end
 end end
 for _,line in ipairs(plan.lines) do if line.active~=false and line.machines>0.000001 then
  list.add{type='sprite-button',sprite='entity/'..line.machine,style='slot_button',tooltip=prototypes.entity[line.machine].localised_name,tags={toby_layout='pedia',kind='entity',prototype=line.machine}}
  local available=false
  for _,item in pairs(prototypes.entity[line.machine].items_to_place_this or {}) do if unlocked[item.name] then available=true;break end end
  text(list,{'',math.ceil(line.machines-0.000000001),' × ',prototypes.entity[line.machine].localised_name,'\n',prototypes.recipe[line.recipe].localised_name,available and '' or '\nRequires research'},228)
 end end
 left.add{type='line'}
 text(left,'Block',280,'bold_label')
 local dimensions=left.add{type='flow',direction='horizontal'}
 r.width=numeric(dimensions,'width',settings.width);text(dimensions,'×',16);r.height=numeric(dimensions,'height',settings.height);text(dimensions,'tiles',56)
 local grid=left.add{type='table',column_count=2}
 r.shape=choice(grid,'Shape',{'Auto','Wide','Tall','Square'},index_of(shapes,settings.layout.shape))
 r.spacing=choice(grid,'Spacing',{'Compact','Spacious'},index_of(spacings,settings.layout.spacing))
 r.inputs=choice(grid,'Inputs',{'Belts','Requester chests'},index_of(transport_modes.inputs,settings.transport.inputs))
 r.intermediates=choice(grid,'Internal',{'Belts','Buffer chests'},index_of(transport_modes.intermediates,settings.transport.intermediates))
 r.outputs=choice(grid,'Outputs',{'Belts','Storage chests'},index_of(transport_modes.outputs,settings.transport.outputs))
 r.inputs.tooltip='How raw ingredients enter the block.'
 r.intermediates.tooltip='How items move between machines. Buffer chests supply blue requester chests through robots.'
 r.outputs.tooltip='Where finished products leave the block. Storage chests are filtered to their product.'
 left.add{type='line'};text(left,'Transport',280,'bold_label')
 local tiers=left.add{type='table',column_count=2};r.tiers={}
 for _,row in ipairs{{'belt','Belt tier','transport-belt'},{'inserter','Inserter','inserter'},{'pole','Power pole','electric-pole'},{'pipe','Pipe','pipe'},{'pipe_underground','Underground pipe','pipe-to-ground'}} do
  local value=settings.tiers[row[1]];if not prototypes.entity[value] then value=nil end
  r.tiers[row[1]]=selector(tiers,row[2],value,row[3])
 end
 local robots=left.add{type='flow',direction='vertical'};r.robots=robots;robots.visible=uses_robots(r)
 text(robots,'Logistic network',280,'bold_label')
 local robot_grid=robots.add{type='table',column_count=2}
 text(robot_grid,'Request buffer',124);r.seconds=numeric(robot_grid,'seconds',settings.requestSeconds)
 text(robot_grid,'Output slots',124);r.slots=numeric(robot_grid,'slots',settings.outputSlots)
 text(robots,'Requires a connected logistic network and robots.',280)
 left.add{type='line'}
 local right=body.add{type='frame',direction='vertical',style='inside_deep_frame'};right.style.horizontally_stretchable=true;right.style.vertically_stretchable=true
 local tools=right.add{type='flow',direction='horizontal'}
 r.summary=text(tools,'No blueprint yet',width-490,'bold_label')
 for _,b in ipairs{{'zoom-in','+','Zoom in'},{'zoom-out','−','Zoom out'},{'fit','Fit','Fit blueprint'}} do
  tools.add{type='button',caption=b[2],style='toby_planner_button_frame_tool',tags=tagged(b[1]),tooltip=b[3]}
 end
 local preview=right.add{type='flow',direction='vertical'};preview.style.vertically_stretchable=true;preview.style.horizontally_stretchable=true
 r.empty=text(preview,'Generate a layout to preview the blueprint here.',width-405)
 r.camera=preview.add{type='camera',position={0,0},surface_index=player.surface.index,zoom=0.5,visible=false}
 -- Cameras have no intrinsic width. Explicit bounds keep the widget visible when the settings pane starts scrolling.
 r.camera.style.width=width-405;r.camera.style.height=height-225
 local pan=right.add{type='flow',direction='horizontal'}
 for _,b in ipairs{{'pan-left','←'},{'pan-up','↑'},{'pan-down','↓'},{'pan-right','→'}} do pan.add{type='button',caption=b[2],style='toby_planner_button_frame_tool',tags=tagged(b[1])} end
 text(right,'Blueprint preview · No world placement',width-405)
 local status=frame.add{type='flow',direction='horizontal'};r.status=text(status,'',width-120);r.status.style.maximal_height=64;r.elapsed=text(status,'',60)
 local footer=frame.add{type='flow',direction='horizontal'}
 r.generate=footer.add{type='button',caption='Generate layout',style='toby_planner_button_green',tags=tagged('generate')}
 r.cancel=footer.add{type='button',caption='Cancel',tags=tagged('cancel')}
 r.inspect=footer.add{type='button',caption='Blueprint editor',tags=tagged('inspect')}
 r.take=footer.add{type='button',caption='Take blueprint',tags=tagged('take')}
 footer.add{type='button',caption='Take Toby book',tags=tagged('book')}
 frame.force_auto_center();player.opened=frame;refresh(player);return true
end
local function number(field,min,max)
 local n=tonumber(field.text);assert(n and n>=min and n<=max,'Enter a number from '..min..' to '..max)
 return n
end
local function settings_from(r)
 local settings={width=number(r.width,8,100),height=number(r.height,8,100),layout={shape=shapes[r.shape.selected_index],spacing=spacings[r.spacing.selected_index]},
  transport={inputs=transport_modes.inputs[r.inputs.selected_index],intermediates=transport_modes.intermediates[r.intermediates.selected_index],outputs=transport_modes.outputs[r.outputs.selected_index]},requestSeconds=number(r.seconds,1,300),outputSlots=number(r.slots,1,48),tiers={}}
 assert(settings.width%1==0 and settings.height%1==0 and settings.requestSeconds%1==0 and settings.outputSlots%1==0,'Use whole tile, buffer and slot counts')
 for name,field in pairs(r.tiers) do settings.tiers[name]=field.elem_value end
 assert(settings.tiers.belt and settings.tiers.inserter and settings.tiers.pole,'Choose a belt tier, inserter and power pole')
 return settings
end
local function announce(player,w)
 log('[TOBY_LAYOUT] '..helpers.table_to_json{player=player.name,id=w.requestId,planId=w.id})
end
function M.generate(index)
 local player=assert(game.get_player(index));local w,v=current(player);assert(w and v.refs,'Open a layout first')
 local plan=plan_for(player,w.id);assert(plan.valid and plan.status=='solved','Finish or repair this plan before laying it out')
 assert(w.status~='queued' and w.status~='compiling','This layout is already running')
 local settings=settings_from(v.refs)
 local s=state();s.sequence=s.sequence+1
 w.settings=settings;w.requestId=tostring(player.force.index)..'/'..w.id..'/'..s.sequence
 w.revision=plan.revision;w.player=player.name;w.started=game.tick;w.status='queued';w.error=nil;v.error=nil;v.dirty=false
 for _,p in pairs(player.force.players) do local view=state().viewers[p.index];if view and view.id==w.id and p.index~=player.index then view.dirty=true end end
 announce(player,w);refresh(player);return w.requestId
end
function M.read_request(player_name,id,plan_id)
 local player=game.get_player(player_name);if not player or not player.connected then return nil end
 local force=state().forces[player.force.index];local w=force and force[plan_id]
 if not w or w.player~=player.name or w.requestId~=id or (w.status~='queued' and w.status~='compiling') then return nil end
 local plan=plan_for(player,w.id)
 if plan.revision~=w.revision then w.status='failed';w.error='Plan changed · Generate a new layout';return nil end
 local s=w.settings;w.status='compiling';w.heartbeat=game.tick
 local result={force=player.force.name,player=player.name,reference=plan.reference,expectedRevision=w.revision,
  width=s.width,height=s.height,layout=s.layout,tiers=s.tiers,transport=s.transport}
 if s.transport.inputs~='belts' or s.transport.intermediates~='belts' or s.transport.outputs~='belts' then
  result.logistics={requester='requester-chest',provider='storage-chest',buffer=s.transport.intermediates=='buffer-chests' and 'buffer-chest' or nil,requestSeconds=s.requestSeconds,outputSlots=s.outputSlots}
 end
 return result
end
local function preview(player,w,stack)
 local surface=w.surface and game.surfaces[w.surface]
 if not surface then
  local name='toby-trial-layout-'..player.force.index..'-'..w.id
  surface=game.surfaces[name] or game.create_surface(name,{width=256,height=256,autoplace_controls={},autoplace_settings={entity={treat_missing_as_default=false},tile={treat_missing_as_default=false},decorative={treat_missing_as_default=false}}})
  w.surface=surface.name;surface.daytime=0;surface.freeze_daytime=true
  surface.localised_name='Toby blueprint preview'
  for _,force in pairs(game.forces) do force.set_surface_hidden(surface,true) end
  surface.show_clouds=false;surface.always_day=true
 end
 -- Surface.clear removes chunks asynchronously; reuse terrain and remove only old preview ghosts.
 for _,entity in pairs(surface.find_entities_filtered{type={'entity-ghost','tile-ghost'}}) do entity.destroy() end
 surface.request_to_generate_chunks({0,0},4);surface.force_generate_chunk_requests()
 local tiles={};for y=-64,64 do for x=-64,64 do tiles[#tiles+1]={name='lab-dark-1',position={x,y}} end end;surface.set_tiles(tiles)
 local entities=stack.get_blueprint_entities();assert(entities and #entities>0,'Blueprint has no entities')
  -- Only ghosts exist here. No inventory, production, power or research is created.
 local ghosts=stack.build_blueprint{surface=surface,force=player.force,position={0,0},force_build=true,skip_fog_of_war=true}
 local floors=stack.get_blueprint_tiles() or {}
 if #floors>0 then
  local first=entities[1];local anchor
  for _,g in pairs(ghosts) do if g.valid and g.type=='entity-ghost' and g.ghost_name==first.name then anchor=g.position;break end end
  assert(anchor,'Could not position the blueprint floor')
  local placed={};for _,tile in ipairs(floors) do placed[#placed+1]={name=tile.name,position={x=tile.position.x+anchor.x-first.position.x,y=tile.position.y+anchor.y-first.position.y}} end
  for _,g in pairs(ghosts) do if g.valid then g.destroy() end end
  surface.set_tiles(placed)
  ghosts=stack.build_blueprint{surface=surface,force=player.force,position={0,0},force_build=true,skip_fog_of_war=false}
 end
 local count=0;for _,g in pairs(ghosts) do if g.valid and g.type=='entity-ghost' then count=count+1 end end
 assert(count==#entities,'Could not preview every blueprint entity')
 player.force.chart(surface,{{-128,-128},{128,128}})
 local box=surface.find_entities_filtered{type='entity-ghost'}
 local left,top,right,bottom=math.huge,math.huge,-math.huge,-math.huge
 for _,e in ipairs(box) do left=math.min(left,e.bounding_box.left_top.x);top=math.min(top,e.bounding_box.left_top.y);right=math.max(right,e.bounding_box.right_bottom.x);bottom=math.max(bottom,e.bounding_box.right_bottom.y) end
 w.center={x=(left+right)/2,y=(top+bottom)/2};w.zoom=math.min(1,480/(math.max(right-left,bottom-top)+6)/32)
 w.entityCount=#entities
end
function M.complete(player_name,id,plan_id,result)
 local player=game.get_player(player_name);if not player then return false end
 local force=state().forces[player.force.index];local w=force and force[plan_id]
 if not w or w.requestId~=id or w.player~=player.name or (w.status~='queued' and w.status~='compiling') then return false end
 if not fresh(player,w) then w.status='failed';w.error='Plan changed · Generate a new layout';return false end
 if result.error then w.status='failed';w.error=tostring(result.error):sub(1,500)
 else
  local inventory=game.create_inventory(1)
  local ok,err=pcall(function()
   assert(type(result.blueprint)=='string' and #result.blueprint<=262144 and result.blueprint:sub(1,1)=='0','Invalid blueprint result')
   local stack=inventory[1];assert(stack.import_stack(result.blueprint)==0 and stack.is_blueprint,'Could not import layout blueprint')
   preview(player,w,stack)
   w.blueprint=result.blueprint;w.blueprintRevision=w.revision;w.status='ready';w.error=nil
   local plan=plan_for(player,w.id)
   local accepted=books.remember(player,{blueprints={{id='layout-'..id,chatId='planner/'..w.id,title=plan.name,label=plan.name,blueprint=w.blueprint,designId=result.designId,revisionOf=w.designId}}})
   if #accepted.blueprints==0 then w.error='Blueprint ready · Toby book is full; take this blueprint directly.' else w.designId=result.designId end
  end)
  inventory.destroy()
  if not ok then w.status='failed';w.error='Preview failed: '..tostring(err):sub(1,450) end
 end
 for _,p in pairs(player.force.players) do local view=state().viewers[p.index];if view and view.id==w.id then if view.refs then view.refs.surface=nil end;refresh(p) end end
 return w.status=='ready'
end
local function take(player,inspect)
 local w,v=current(player);assert(w and w.status=='ready' and w.blueprint and w.blueprintRevision==w.revision and fresh(player,w) and not v.dirty,'Generate a layout for the current plan and settings first')
 assert(player.clear_cursor(),'Clear inventory space before taking the blueprint')
 assert(player.cursor_stack.import_stack(w.blueprint)==0,'Could not import blueprint')
 if inspect then v.handoff=true;player.opened=player.cursor_stack else close(player) end
end
local function click(event)
 local e=event.element;if not e or not e.valid or not e.tags.toby_layout then return end
 local player=game.get_player(event.player_index);local action=e.tags.toby_layout
 local ok,err=pcall(function()
  if action=='close' or action=='back' then close(player,true);return end
  if action=='pedia' then local _,v=current(player);if v then v.handoff=true end;player.open_factoriopedia_gui(prototypes[e.tags.kind][e.tags.prototype]);return end
  if action=='generate' then M.generate(player.index);return end
  if action=='book' then books.take(player,false);return end
  if action=='cancel' then local w=current(player);if w then w.status='cancelled';w.error='Cancelled';refresh(player) end;return end
  if action=='take' or action=='inspect' then take(player,action=='inspect');return end
  local w,v=current(player);if not w or not v.refs then return end
  local camera=v.refs.camera
  if action=='fit' and w.center then camera.position=w.center;camera.zoom=w.zoom
  elseif action=='zoom-in' then camera.zoom=math.min(2,camera.zoom*1.25)
  elseif action=='zoom-out' then camera.zoom=math.max(.05,camera.zoom/1.25)
  elseif action:sub(1,4)=='pan-' then
   local p=camera.position;local delta=4/math.max(.1,camera.zoom)
   if action=='pan-left' then p.x=p.x-delta elseif action=='pan-right' then p.x=p.x+delta elseif action=='pan-up' then p.y=p.y-delta else p.y=p.y+delta end
   camera.position=p
  end
 end)
 if not ok then local _,v=current(player);if v and v.refs then v.error=tostring(err):sub(1,500);refresh(player) else player.print(tostring(err)) end end
end
local function dirty(event)
 local e=event.element;if not e or not e.valid or e.tags.toby_layout~='dirty' then return end
 local player=game.get_player(event.player_index);local _,v=current(player)
 if v and v.refs then v.error=nil;v.dirty=true;refresh(player) end
end
events.on_event(defines.events.on_gui_click,click)
for _,event in ipairs{defines.events.on_gui_text_changed,defines.events.on_gui_selection_state_changed,defines.events.on_gui_checked_state_changed,defines.events.on_gui_elem_changed} do events.on_event(event,dirty) end
events.on_event(defines.events.on_gui_closed,function(event)
 if event.element and event.element.valid and event.element.name==PREFIX..'frame' then
  local player=game.get_player(event.player_index);local _,v=current(player)
  if v and v.handoff then v.handoff=nil;return end
  close(player,true)
 end
end)
events.on_event(defines.events.on_player_changed_force,function(event) close(game.get_player(event.player_index));state().viewers[event.player_index]=nil end)
events.on_nth_tick(60,function()
 for index,v in pairs(state().viewers) do local p=game.get_player(index);if p then refresh(p) end end
 for _,force in pairs(state().forces) do for _,w in pairs(force) do
  if w.status=='queued' or w.status=='compiling' then
   local player=game.get_player(w.player)
   if player and player.connected and player.force.index==w.force and game.tick%300==0 and (not w.heartbeat or game.tick-w.heartbeat>1800) then announce(player,w) end
  end
 end end
end)
remote.add_interface('facmandu-toby-layout',{open=M.open,generate=M.generate,read_request=M.read_request,complete=M.complete})
return M
