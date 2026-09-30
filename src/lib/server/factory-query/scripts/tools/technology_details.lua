-- Research facts for native web cards. Prototype data is read-only on both 2.0 and 2.1.
local M = {}
function M.add(tech, row)
  if not tech then return row end
  row.ingredients = tech.research_unit_ingredients
  row.trigger = tech.prototype.research_trigger
  if not row.trigger then row.units = row.units or tech.research_unit_count end
  local unlocks = {}
  for _, effect in pairs(tech.prototype.effects) do
    if effect.type == "unlock-recipe" then unlocks[#unlocks + 1] = effect.recipe end
  end
  table.sort(unlocks)
  row.unlocks_total = #unlocks
  -- Bound large overhaul technology cards; report omitted unlocks to the UI.
  while #unlocks > 12 do table.remove(unlocks) end
  row.unlocks = unlocks
  return row
end
return M
