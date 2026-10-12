-- K2 turns electronics into science research requiring automation and red science.
-- APS puts electronics before both on Vulcanus. Use an early smelting trigger,
-- as APS does for the other starting technologies, without granting research.
if settings.startup['aps-planet'].value ~= 'vulcanus' then return end
local electronics = data.raw.technology.electronics
local automation = data.raw.technology.automation
local function includes(values, name)
  for _, value in pairs(values or {}) do
    if value == name then return true end
  end
  return false
end

-- K2's final fixes replace the Vulcanus mining trigger with crafting raw stone.
-- Raw stone cannot be crafted at this stage; keep the prerequisite and require smelting.
local crusher = data.raw.technology['kr-crusher']
if crusher and crusher.research_trigger and crusher.research_trigger.type == 'craft-item'
  and crusher.research_trigger.item == 'stone' then
  crusher.research_trigger = { type = 'craft-item', item = 'stone-brick', count = 50 }
end
-- Retire this override once upstream no longer introduces the reversed dependency.
if electronics and automation and includes(automation.prerequisites, 'electronics')
  and includes(electronics.prerequisites, 'automation') then
  electronics.prerequisites = {}
  electronics.unit = nil
  electronics.research_trigger = { type = 'craft-item', item = 'copper-plate', count = 5 }
end
