-- AI Agent Bridge - scripts/tools/locate.lua
-- Author: bits-orio
-- License: MIT
--
-- Where things are: find_entities and locate_player, the two reads behind a
-- "where" question, each answering with positions the model writes as
-- [gps=x,y,surface] so a player can click the ping.
--
-- Both walk exactly one surface, never the game. find_entities asks the
-- engine for one force's entities of one name or type on one surface,
-- capped at SCAN_CAP so a base of a hundred thousand machines costs one
-- bounded pass, then keeps the ones on the recipe asked for. The system
-- prompt tells the model to ask the player which surface when the question
-- does not say and the force has several.
--
-- API names verified against the 2.0.77 docs:
--   LuaSurface::find_entities_filtered(filter) -> array[LuaEntity];
--     EntitySearchFilters: name, type, force, limit, all optional; with no
--     area, position or radius it covers the surface; position with radius
--     covers that circle and nothing else.
--   LuaEntity::get_recipe() -> LuaRecipe? (crafting machines), ::position,
--     ::name, ::type. LuaPlayer::position, ::surface, ::connected.

local force_lookup   = require("scripts.tools.force_lookup")
local surface_lookup = require("scripts.tools.surface_lookup")
local bounded        = require("scripts.tools.bounded")

local SCAN_CAP      = 2000
local DEFAULT_SHOWN = 5
local MAX_SHOWN     = 50

-- nearby: the circle locate_player reads around a character. 32 tiles is a
-- generous "next to", and a radius read of a circle that size is bounded by
-- its area whatever the surface holds.
local NEARBY_MAX   = 32
local NEARBY_SHOWN = 5

-- Entity types that have a recipe to filter on, as the list the engine filter
-- takes and as the set recipe_of tests against. One source, two shapes.
-- EntitySearchFilters::type and ::ghost_type each take a string or an array of
-- strings (verified against the 2.0.77 docs).
local CRAFTER_TYPES = { "assembling-machine", "furnace", "rocket-silo" }
local CRAFTERS = {}
for _, crafter in ipairs(CRAFTER_TYPES) do CRAFTERS[crafter] = true end

--- A ghost is an entity of type entity-ghost whose real prototype sits in
--- ghost_name and ghost_type; everything below asks these two so a ghost
--- and a built machine read the same way.
local function is_ghost(entity) return entity.type == "entity-ghost" end
local function real_name(entity) return is_ghost(entity) and entity.ghost_name or entity.name end
local function real_type(entity) return is_ghost(entity) and entity.ghost_type or entity.type end

--- The recipe set on a crafting machine or on the ghost of one, or nil.
--- pcall'd: a ghost of something the engine will not answer for must read
--- as "no recipe", never as an error that ends the whole search.
local function recipe_of(entity)
  if not CRAFTERS[real_type(entity)] then return nil end
  local ok, recipe = pcall(entity.get_recipe)
  if ok and recipe and recipe.valid ~= false then return recipe end
  return nil
end

local M = {}

M.manifest = {
  find_entities = {
    desc = "Where one force's entities are on one surface: positions with a ready [gps=...] tag. Filter by entity name, type (assembling-machine, furnace, mining-drill, lab, roboport, rocket-silo), the recipe a crafting machine is set to, or the item or fluid its recipe makes (where are grenades made: product=grenade). A recipe or product search covers every crafting machine on the surface by itself; a type beside it is not needed. Ghosts match too, by what they will become, and rows say ghost=true; ghost=true or false narrows to ghosts or built. With x, y and radius, omit filters to inspect all infrastructure in that bounded area, including stored-supply endpoints. types counts every matched entity type, including omitted rows; use a type filter to inspect those entities. details=true includes built supply inventories, stored fluids, belt capacity and power headroom, prioritizing supply and connection endpoints. Fluid amounts in connected segments are shared; do not sum pipe/tank rows as independent stock. Otherwise give at least one filter. Product searches find crafting machines, not items in chests or fluids in tanks. truncated=true means the scan stopped before the end of the surface, so the rows are what it saw and nothing in the reply says a thing is absent. An unknown name comes back found=false with suggestions of close names. For a count, entity_count is cheaper: it asks the engine for a number instead of walking positions.",
    tier = "2",
    params = {
      surface = "string! surface name or index, e.g. nauvis",
      x       = "number search center x; requires y and radius",
      y       = "number search center y; requires x and radius",
      radius  = "number local search radius, 1 to 96 tiles; requires x and y",
      name    = "string entity prototype name, e.g. lab, assembling-machine-2",
      type    = "string entity type, e.g. assembling-machine, furnace, mining-drill",
      recipe  = "string recipe name a crafting machine is set to, e.g. repair-pack",
      product = "string item or fluid name a crafting machine's recipe makes, e.g. military-science-pack",
      ghost   = "boolean true for ghosts only, false for built entities only; omit for both",
      details = "boolean include bounded stored supplies, belt capacity and native power headroom; requires a local x/y/radius",
      limit   = "integer positions to return, default " .. DEFAULT_SHOWN .. ", max " .. MAX_SHOWN,
    },
  },
  locate_player = {
    desc = "Locate players on the selected force: physical surface and exact position, connected status, and remote view when different. Offline positions are last known locations, not evidence of presence. all=true includes offline players; connected_only=true restricts to online players. nearby=N lists nearby builds on this force, nearest first, with exact positions and entity IDs. Use these locations to inspect existing infrastructure even when nobody is online. Unknown player: found=false.",
    params = {
      player = "string player name; required unless all=true",
      all    = "boolean every player on the selected force in one call; player is ignored",
      connected_only = "boolean restrict all=true to online players, default false",
      nearby = "integer tiles, 1 to " .. NEARBY_MAX .. ": list the built things within this radius of the character",
    },
  },
}

-- Up to five prototype names sharing a fragment of three or more letters
-- with what was asked for, so "repair-kit" answers with repair-pack. One
-- pass over one prototype table, only on the miss.
local MAX_SUGGESTIONS = 5

local function suggestions(table_, query)
  local out, seen = {}, {}
  for fragment in tostring(query):lower():gmatch("[%l%d]+") do
    if #fragment >= 3 then
      for name in pairs(table_) do
        if not seen[name] and name:lower():find(fragment, 1, true) then
          seen[name] = true
          out[#out + 1] = name
        end
      end
    end
  end
  table.sort(out, function(a,b) if #a~=#b then return #a<#b end return a<b end)
  while #out > MAX_SUGGESTIONS do table.remove(out) end
  return out
end

--- Whether a recipe makes `product`, by product name.
local function makes(recipe, product)
  for _, p in ipairs(recipe.products or {}) do
    if p.name == product then return true end
  end
  return false
end

local function gps(position, surface_name)
  local x, y = math.floor(position.x + 0.5), math.floor(position.y + 0.5)
  return position.x, position.y, string.format("[gps=%d,%d,%s]", x, y, surface_name)
end

-- What a player stands beside is something a force placed. Scenery and
-- wildlife belong to neutral or enemy, and a few forced things are not
-- builds either: players themselves, their corpses, the marker a
-- construction request leaves, an item lying on the ground.
local NOT_A_BUILD = {
  character = true, ["character-corpse"] = true, corpse = true,
  ["item-request-proxy"] = true, ["highlight-box"] = true, ["item-entity"] = true,
}

local function is_build(entity, own_character)
  if not entity.valid or entity == own_character or NOT_A_BUILD[entity.type] then return false end
  local force = entity.force
  return force ~= nil and force.name ~= "neutral" and force.name ~= "enemy"
end

--- The built things within `radius` tiles of `position` on `surface`,
--- nearest first, cut to NEARBY_SHOWN, and how many there were before the
--- cut. EntitySearchFilters.position with .radius asks the engine for the
--- entities inside that circle and nothing else (2.0.77: "If given with
--- position, will return all entities within the radius of the position"),
--- so the cost is the circle's, never the surface's. On 2026-09-16 the
--- question "what is each player standing next to" had no bounded read to
--- reach for at all.
local function nearest_builds(surface, position, radius, own_character, force)
  local found = {}
  for _, entity in ipairs(surface.find_entities_filtered({ position = position, radius = radius, force = force.name })) do
    if is_build(entity, own_character) then
      local dx, dy = entity.position.x - position.x, entity.position.y - position.y
      found[#found + 1] = { entity = entity, distance = math.sqrt(dx * dx + dy * dy) }
    end
  end
  table.sort(found, function(p, q)
    if p.distance ~= q.distance then return p.distance < q.distance end
    return real_name(p.entity) < real_name(q.entity)
  end)
  local rows = {}
  for i, near in ipairs(bounded.cut(found, NEARBY_SHOWN)) do
    local x, y, tag = gps(near.entity.position, surface.name)
    local row = { name = real_name(near.entity), type = real_type(near.entity), unit_number = near.entity.unit_number, direction = near.entity.direction,
                  distance = bounded.round(near.distance, 1), x = x, y = y, gps = tag }
    if is_ghost(near.entity) then row.ghost = true end
    rows[i] = row
  end
  return rows, #found
end

local function nearby_radius(v)
  if v == nil then return nil end
  if type(v) ~= "number" then error("nearby must be a number of tiles", 0) end
  return math.max(1, math.min(NEARBY_MAX, math.floor(v)))
end

local function optional_string(v, what)
  if v == nil then return nil end
  if type(v) ~= "string" or v == "" then error(what .. " must be a non-empty string", 0) end
  return v
end

local function find_entities(a)
  local force = force_lookup.require_force(a.force)
  local surface, miss = surface_lookup.find(a.surface)
  if not surface then
    miss.force = force.name
    return miss
  end
  local name    = optional_string(a.name, "name")
  local etype   = optional_string(a.type, "type")
  local recipe  = optional_string(a.recipe, "recipe")
  local product = optional_string(a.product, "product")
  local position
  if a.x ~= nil or a.y ~= nil or a.radius ~= nil then
    if type(a.x) ~= 'number' or type(a.y) ~= 'number' or type(a.radius) ~= 'number'
      or math.abs(a.x) > 1000000 or math.abs(a.y) > 1000000 or a.radius < 1 or a.radius > 96 then
      error('local searches require numeric x, y and radius (1 to 96)', 0)
    end
    position = {x=a.x,y=a.y}
  end
  if a.details~=nil and type(a.details)~='boolean' then error('details must be boolean',0) end
  if a.details and not position then error('details requires a bounded local x/y/radius',0) end
  local ghost   = a.ghost
  if ghost ~= nil and type(ghost) ~= "boolean" then error("ghost must be true or false", 0) end
  if not (position or name or etype or recipe or product) then
    error("give a bounded x/y/radius or at least one of name, type, recipe or product", 0)
  end
  if name and not prototypes.entity[name] then
    return { found = false, force = force.name, surface = surface.name, name = name,
             reason = "no entity prototype by that name: use the internal name, for example assembling-machine-2",
             suggestions = suggestions(prototypes.entity, name) }
  end
  if recipe and not prototypes.recipe[recipe] then
    return { found = false, force = force.name, surface = surface.name, recipe = recipe,
             reason = "no recipe by that name: use the internal name, for example repair-pack",
             suggestions = suggestions(prototypes.recipe, recipe) }
  end
  if product and not (prototypes.item[product] or prototypes.fluid[product]) then
    return { found = false, force = force.name, surface = surface.name, product = product,
             reason = "no item or fluid by that name: use the internal name, for example military-science-pack",
             suggestions = suggestions(prototypes.item, product) }
  end

  -- Built entities and ghosts are two engine passes, because a name or type
  -- filter matches the ghost shell ("entity-ghost") rather than what it will
  -- become; ghost_name and ghost_type are the ghost-side twins. With no name
  -- or type, one pass over everything covers both.
  local scanned = {}
  local function scan(filter)
    filter.position, filter.radius = position, a.radius
    filter.force, filter.limit = force.name, SCAN_CAP - #scanned
    if filter.limit <= 0 then return end
    for _, entity in ipairs(surface.find_entities_filtered(filter)) do scanned[#scanned + 1] = entity end
  end
  -- A recipe or product filter can only ever match a crafting machine, so a
  -- search that names neither an entity nor a type asks the engine for the
  -- three crafter types rather than for everything. An unfiltered pass spends
  -- the whole SCAN_CAP on belts, inserters and poles and then reports zero
  -- matches on a surface that has the machine: measured on a live server,
  -- product=firearm-magazine scanned 2000 entities and found none of the six
  -- assembling machines set to it, where the same search over the crafter
  -- types scanned 335 and found all six.
  local types = etype
  if not (name or etype) and (recipe or product) then types = CRAFTER_TYPES end

  if name or types then
    if ghost ~= true then scan({ name = name, type = types }) end
    if ghost ~= false then scan({ ghost_name = name, ghost_type = types }) end
  else
    scan({})
  end

  local matches = {}
  for _, entity in ipairs(scanned) do
    local keep = ghost == nil or is_ghost(entity) == ghost
    if keep and (recipe or product) then
      local set = recipe_of(entity)
      keep = set ~= nil
        and (not recipe or set.name == recipe)
        and (not product or makes(prototypes.recipe[set.name] or set, product))
    end
    if keep then matches[#matches + 1] = entity end
  end

  local types = {}
  for _, entity in ipairs(matches) do
    local kind = real_type(entity)
    types[kind] = (types[kind] or 0) + 1
  end
  if a.details then
    local priority={container=1,['logistic-container']=1,['storage-tank']=2,['space-platform-hub']=2,roboport=3,['transport-belt']=4,['underground-belt']=4,splitter=4,['electric-pole']=5,['assembling-machine']=6,furnace=6}
    table.sort(matches,function(a,b)
      local pa,pb=priority[real_type(a)] or 7,priority[real_type(b)] or 7
      if pa~=pb then return pa<pb end
      local da=(a.position.x-position.x)^2+(a.position.y-position.y)^2
      local db=(b.position.x-position.x)^2+(b.position.y-position.y)^2
      if da~=db then return da<db end
      return (a.unit_number or 0)<(b.unit_number or 0)
    end)
  end
  local shown = bounded.cut(matches, bounded.limit(a.limit, DEFAULT_SHOWN, MAX_SHOWN))
  local rows = {}
  for i, entity in ipairs(shown) do
    local x, y, tag = gps(entity.position, surface.name)
    local row = { name = real_name(entity), type = real_type(entity), unit_number = entity.unit_number, direction = entity.direction, x = x, y = y, gps = tag }
    if is_ghost(entity) then row.ghost = true end
    local set = recipe_of(entity)
    if set then row.recipe = set.name end
    if a.details and not is_ghost(entity) then
      if entity.type=='container' or entity.type=='logistic-container' or entity.type=='space-platform-hub' then
        local inventory=entity.get_inventory(entity.type=='space-platform-hub' and defines.inventory.hub_main or defines.inventory.chest)
        local contents=inventory and inventory.get_contents() or {}
        table.sort(contents,function(a,b) if a.count~=b.count then return a.count>b.count end return a.name<b.name end)
        row.contents={total_kinds=#contents,items=bounded.cut(contents,12),truncated=#contents>12}
      elseif entity.type=='storage-tank' or entity.type=='pipe' or entity.type=='pipe-to-ground' then
        row.stored_fluids=entity.get_fluid_contents()
      elseif entity.type=='transport-belt' or entity.type=='underground-belt' then
        row.capacity_per_min=entity.prototype.belt_speed*480*60
        row.stored_items=entity.get_item_count()
      elseif entity.type=='electric-pole' then
        local major,minor=(script.active_mods.base or ''):match('^(%d+)%.(%d+)')
        if tonumber(major) and (tonumber(major)>2 or (tonumber(major)==2 and tonumber(minor)>=1)) then
          local network=entity.electric_network
          local flow=network and network.parent_network.flow_last_tick
          if flow then row.power={satisfaction=flow.consumption_satisfaction,available_generation_w=bounded.round(flow.maximum_production*60,0),requested_consumption_w=bounded.round(flow.maximum_consumption*60,0)} end
        end
      end
    end
    rows[i] = row
  end
  return {
    found = true, force = force.name, surface = surface.name,
    name = name, type = etype, recipe = recipe, product = product, ghost = ghost,
    position = position, radius = a.radius,
    scanned = #scanned, truncated = #scanned >= SCAN_CAP,
    total = #matches, shown = #rows, omitted = #matches - #rows, types = types, entities = rows,
  }
end

--- One player's row: where the character is, what it is looking at and,
--- with a radius, what stands beside it.
local function locate_one(player, nearby, force)
  -- The character's place is the answer to "where is Bob"; the controller's
  -- surface (remote view) is reported beside it when it differs, since that
  -- is what Bob is looking at right now.
  local physical = player.physical_surface and player.physical_surface.valid and player.physical_surface or player.surface
  local surface_name = physical and physical.name or "?"
  local position = player.physical_position or player.position
  local x, y, tag = gps(position, surface_name)
  local out = {
    found = true, force = force.name, player = player.name, connected = player.connected == true,
    surface = surface_name, x = x, y = y, gps = tag,
  }
  local viewing = player.surface and player.surface.valid and player.surface.name or nil
  if viewing and viewing ~= surface_name then out.viewing = viewing end
  if nearby and physical and physical.valid then
    out.nearby_radius = nearby
    out.nearest, out.nearby_total = nearest_builds(physical, position, nearby, player.character, force)
  end
  return out
end

local function locate_player(a)
  local force = force_lookup.require_force(a.force)
  local nearby = nearby_radius(a.nearby)
  if a.all == true then
    local rows = {}
    for _, player in pairs(a.connected_only == true and game.connected_players or game.players) do
      if player.valid and player.force.name == force.name then rows[#rows + 1] = locate_one(player, nearby, force) end
    end
    table.sort(rows, function(p, q) return p.player < q.player end)
    local shown = bounded.fit(bounded.cut(rows, bounded.MAX_FORCES))
    return { found = true, force = force.name, total = #rows, shown = #shown, players = shown }
  end
  if type(a.player) ~= "string" or a.player == "" then error("player is required unless all=true", 0) end
  local player = game.get_player(a.player)
  if not (player and player.valid and player.force.name == force.name) then
    return { found = false, force = force.name, player = a.player, reason = "no player on this force by that name" }
  end
  return locate_one(player, nearby, force)
end

M.functions = { find_entities = find_entities, locate_player = locate_player }
M.suggestions = suggestions

return M
