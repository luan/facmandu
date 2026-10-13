-- AI Agent Bridge - scripts/tools/production.lua
-- Author: bits-orio
-- License: MIT
--
-- item_rate and top_items: both read LuaFlowStatistics for one force and one
-- surface. get_flow_count without a sample_index returns the average across
-- the whole precision window, already normalised to per-minute for item
-- statistics (see scripts/tools/flow.lua for the quoted documentation).
-- "input" is the production side (items flowing onto the network), "output"
-- is consumption. Both sum every quality, so a force that makes one plate at
-- five qualities reads its whole output rather than the normal-quality part.

local force_lookup   = require("scripts.tools.force_lookup")
local surface_lookup = require("scripts.tools.surface_lookup")
local flow           = require("scripts.tools.flow")
local bounded        = require("scripts.tools.bounded")

local MAX_TOP_N = 50

local M = {}

M.manifest = {
  science_summary = {
    desc = "One synchronized snapshot of every science item actually used by this force's technologies, including modded packs, recent production/consumption across created surfaces and current research requirements. Use first for science/research supply questions instead of guessing pack names and querying each separately. Rates are observations, not capacity or delivery proof; idle research and buffered outputs can give zero rates without a shortage. Up to 64 packs and 16 surfaces; truncation is explicit. Read only.",
    params = {window = "string default one_minute; a span from " .. flow.window_names},
  },
  item_rate = {
    desc = "Recent production and consumption rate of one item on one surface, items/min over all qualities. Five-second windows can show bursts; use at least one_minute to check sustained capacity. Production is not delivery: also inspect output routing and destination counts over game ticks before claiming a full belt. For totals use production_since. Unknown surface: found=false.",
    params = {
      surface = "string! surface name or index, e.g. nauvis",
      item    = "string! item prototype name",
      window  = "string! the average's span, one of " .. flow.window_names .. "; the shortest that covers the question, one_minute for right now",
    },
  },
  top_items = {
    desc = "The N items one force makes fastest on one surface over a window, by rate over all qualities. Rates, not totals. Unknown surface: found=false.",
    params = {
      surface = "string! surface name or index, e.g. nauvis",
      window  = "string! the average's span, one of " .. flow.window_names .. "; the shortest that covers the question, one_minute for right now",
      n       = "integer! items to return, max " .. MAX_TOP_N,
    },
  },
}

local function item_rate(a)
  local force = force_lookup.require_force(a.force)
  local surface, miss = surface_lookup.find(a.surface)
  if not surface then
    miss.force = force.name
    return miss
  end
  local window = flow.require_window(a.window)
  if type(a.item) ~= "string" or a.item == "" then error("item is required", 0) end
  if not prototypes.item[a.item] then
    return { found = false, force = force.name, surface = surface.name,
      item = a.item, reason = "no item prototype by that name" }
  end

  local stats = force.get_item_production_statistics(surface)
  local spec = { item = a.item, qualities = flow.quality_names(), window = window }
  local produced = flow.item_flow(stats, spec, "input")
  local consumed = flow.item_flow(stats, spec, "output")
  return {
    found = true,
    force = force.name, surface = surface.name, item = a.item, window = a.window,
    all_qualities = true,
    observed_at_tick = game.tick,
    averaging_window_ticks = window.ticks,
    rate_scope = 'Force production, not output-belt delivery',
    produced_per_min = bounded.round(produced, 2),
    consumed_per_min = bounded.round(consumed, 2),
    net_per_min = bounded.round(produced - consumed, 2),
  }
end

local function top_items(a)
  local force = force_lookup.require_force(a.force)
  local surface, miss = surface_lookup.find(a.surface)
  if not surface then
    miss.force = force.name
    return miss
  end
  local window = flow.require_window(a.window)
  local n = bounded.limit(a.n, 10, MAX_TOP_N)

  local stats = force.get_item_production_statistics(surface)
  local seen = {}
  for name in pairs(stats.input_counts or {}) do seen[name] = true end
  for name in pairs(stats.output_counts or {}) do seen[name] = true end

  local spec = { qualities = flow.quality_names(), window = window }
  local rows = {}
  for name in pairs(seen) do
    spec.item = name
    local rate = flow.item_flow(stats, spec, "input")
    if rate > 0 then
      rows[#rows + 1] = { item = name, rate = rate }
    end
  end
  -- Sorted on the raw rate, rounded only on the rows that go out.
  -- bounded.round hands back a number for a whole rate and a short decimal
  -- STRING for a fraction, and Lua's `>` throws comparing the two, so a sort
  -- on the rounded field failed whenever one item's rate happened to be
  -- whole beside another's that was not: "what do we make most" answered
  -- with an error on any busy server.
  table.sort(rows, function(x, y)
    if x.rate ~= y.rate then return x.rate > y.rate end
    return x.item < y.item
  end)

  local top = {}
  for i, row in ipairs(bounded.cut(rows, n)) do
    top[i] = { item = row.item, produced_per_min = bounded.round(row.rate, 2) }
  end
  return {
    found = true,
    force = force.name, surface = surface.name, window = a.window,
    all_qualities = true, items = top,
  }
end

local function science_summary(a)
  local force=force_lookup.require_force(a.force)
  local window_name=a.window or 'one_minute'
  local window=flow.require_window(window_name)
  local required={}
  local research=force.current_research
  if research then for _,part in pairs(research.research_unit_ingredients or {}) do required[part.name]=part.amount end end
  local names,seen={},{}
  for _,tech in pairs(force.technologies) do
    for _,ingredient in pairs(tech.research_unit_ingredients or {}) do
      if prototypes.item[ingredient.name] and not seen[ingredient.name] then
        seen[ingredient.name]=true;names[#names+1]=ingredient.name
      end
    end
  end
  table.sort(names,function(x,y) if (required[x]~=nil)~=(required[y]~=nil) then return required[x]~=nil end return x<y end)
  local surfaces={}
  for _,surface in pairs(game.surfaces) do surfaces[#surfaces+1]=surface end
  table.sort(surfaces,function(x,y) return x.index<y.index end)
  local pack_total,surface_total=#names,#surfaces
  names=bounded.cut(names,64);surfaces=bounded.cut(surfaces,16)
  local spec={qualities=flow.quality_names(),window=window}
  local packs={}
  for _,name in ipairs(names) do
    local produced,consumed=0,0
    local locations={}
    spec.item=name
    for _,surface in ipairs(surfaces) do
      local stats=force.get_item_production_statistics(surface)
      local input,output=flow.item_flow(stats,spec,'input'),flow.item_flow(stats,spec,'output')
      produced=produced+input;consumed=consumed+output
      if input~=0 or output~=0 then locations[#locations+1]={surface.index,bounded.round(input,2),bounded.round(output,2)} end
    end
    packs[#packs+1]={item=name,produced_per_min=bounded.round(produced,2),consumed_per_min=bounded.round(consumed,2),net_per_min=bounded.round(produced-consumed,2),required_per_unit=required[name],surface_rates=bounded.cut(locations,4),surface_rates_total=#locations}
  end
  local surface_names={}
  for _,surface in ipairs(surfaces) do surface_names[#surface_names+1]={index=surface.index,name=surface.name} end
  local ingredients=research and research.research_unit_ingredients or {}
  return {force=force.name,observed_at_tick=game.tick,window=window_name,all_qualities=true,
    research=research and {active=true,name=research.name,progress=force.research_progress,ingredients=bounded.cut(ingredients,64),ingredients_total=#ingredients} or {active=false},
    sciences=packs,total=pack_total,shown=#packs,surfaces=surface_names,surfaces_total=surface_total,surfaces_shown=#surfaces,truncated=pack_total>#packs or surface_total>#surfaces,
    note='Force production across the shown surfaces, not delivered science or maximum capacity. surface_rates entries are [surface index, produced/min, consumed/min], up to four locations per pack; totals include every shown surface. Zero rates alone do not prove a shortage; check active research, buffers and the relevant machines before expanding.'}
end

M.functions = { item_rate = item_rate, top_items = top_items, science_summary = science_summary }

return M
