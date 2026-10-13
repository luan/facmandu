local M={}
local phases={idle=true,inspecting=true,thinking=true,working=true,speaking=true,success=true,error=true}
function M.clear(state)
 for _,key in ipairs{'visual','shadow'} do
  local object=state[key]
  if object and object.valid then object.destroy() end
  state[key]=nil
 end
end
function M.update(player,state)
 local entity=state.entity
 if not entity.valid then M.clear(state);return end
 if state.visual and state.visual.valid and state.visual.surface~=entity.surface then M.clear(state) end
 local phase=state.activity and state.activity.phase or 'idle'
 if not phases[phase] then phase='idle' end
 if state.job and state.job.valid or state.mode=='move' and entity.autopilot_destination then phase='working' end
 if phase~='error' and game.tick<(state.speaking_until or 0) then phase='speaking' end
 if not state.visual or not state.visual.valid then
  state.visual=rendering.draw_animation{animation='toby-screen-'..phase,animation_speed=0,target=entity,surface=entity.surface,render_layer='air-object'}
  state.shadow=rendering.draw_animation{animation='toby-shadow',animation_speed=0,target=entity,surface=entity.surface,render_layer='object'}
 end
 local direction=math.floor(entity.torso_orientation*16+0.5)%16
 local fps=phase=='idle' and 8 or 12
 state.visual.animation='toby-screen-'..phase
 state.visual.animation_offset=direction*8+math.floor(game.tick*fps/60)%8
 state.shadow.animation_offset=direction
 state.display=phase
 local message=state.activity and state.activity.message
 if player.connected and player.physical_surface==entity.surface and message and #message>0 and message~=state.spoken and game.tick-(state.last_speech or -1200)>=600 then
  player.create_local_flying_text{position={entity.position.x,entity.position.y-2},text=message,color={r=0.6,g=0.9,b=1},time_to_live=300,speed=0.15}
  state.spoken=message;state.last_speech=game.tick;state.speaking_until=game.tick+120
 end
end
function M.activity(player,activity)
 if type(activity)~='table' or not phases[activity.phase] or type(activity.message)~='string' or #activity.message>240 then error('Invalid drone activity',0) end
 local state=(storage.drones or {})[player.index]
 if state then state.activity=activity end
end
return M
