-- AI Agent Bridge - scripts/tools/logistics.lua
-- Author: bits-orio
-- License: MIT
--
-- logistics_summary: the logistic networks one force has on one surface, read
-- off the force's own list of them. The engine already groups its networks by
-- surface. Only the optional coverage report walks bounded factory targets.
--
-- API names verified against the official 2.0.77 docs (fetched 2026-09-10),
-- https://lua-api.factorio.com/2.0.77/classes/LuaForce.html and
-- https://lua-api.factorio.com/2.0.77/classes/LuaLogisticNetwork.html:
--   LuaForce::logistic_networks   R dictionary[string -> array[
--                                 LuaLogisticNetwork]], "List of logistic
--                                 networks, grouped by surface."
--   LuaLogisticNetwork::network_id, cells,
--     all_logistic_robots, available_logistic_robots,
--     all_construction_robots, available_construction_robots
--   LuaLogisticNetwork::get_contents(member?) -> array[ItemWithQualityCount],
--     each {name, quality, count}. Aggregated by name in
--     scripts/tools/logistics_contents.lua.

local force_lookup      = require("scripts.tools.force_lookup")
local surface_lookup    = require("scripts.tools.surface_lookup")
local contents_of       = require("scripts.tools.logistics_contents")
local bounded           = require("scripts.tools.bounded")

-- Five networks of eight item rows each is what fits the reply cap with room to
-- spare. A mall surface can hold dozens of one-roboport networks, and the
-- question behind this tool is always about the big ones.
local DEFAULT_NETWORKS = 5
local MAX_NETWORKS = 5
local CONTENTS_PER_NETWORK = 8

local M = {}

M.manifest = {
  logistics_summary = {
    desc = "Logistic networks of one force on one surface, busiest first: robots, idle robots, cells, a sample of the eight largest item stacks over all qualities. contents_omitted counts unlisted item kinds; an item missing from this sample is not absent. For construction machines, planning_recipes returns exact normal-quality construction_stock. Unknown surface: found=false.",
    params = {
      surface  = "string! surface name or index, e.g. nauvis",
      limit    = "integer networks, default " .. DEFAULT_NETWORKS .. ", max " .. MAX_NETWORKS,
      contents = "boolean include each network's item contents, default true; false skips get_contents",
      coverage = "boolean optional native coverage audit of up to 1000 safe factory targets and 128 fixed ports; reports green construction center/corner samples, orange logistics centers, uncovered coordinates and connected/active ports. Use contents=false for this audit",
    },
  },
}

-- `with_contents = false` skips contents_of.largest entirely, the one call
-- in this function that reaches get_contents(): an ItemWithQualityCount
-- array built for the WHOLE network (logistics_contents.lua's own header),
-- the one expensive thing this tool does. A sweep counting robots or
-- networks across every force and surface never reads what is in a chest,
-- so it asks for this. Every existing caller leaves `with_contents` nil,
-- which reads as true here, so nothing already calling this tool changes.
local function network_row(network, with_contents)
  local row = {
    id = network.network_id,
    cells = #network.cells,
    storage_points = #(network.storage_points or {}),
    logistic_robots = network.all_logistic_robots,
    logistic_robots_available = network.available_logistic_robots,
    construction_robots = network.all_construction_robots,
    construction_robots_available = network.available_construction_robots,
  }
  if with_contents ~= false then
    local contents, distinct = contents_of.largest(network, CONTENTS_PER_NETWORK)
    row.distinct_items = distinct
    row.contents_shown = #contents
    row.contents_omitted = distinct - #contents
    row.contents = contents
  end
  return row
end

-- Coverage is opt-in: ordinary network counts never walk the factory.
local function coverage_report(force, surface)
  local territories = require('scripts.tools.territory')
  local read = territories.reader(force, surface)
  local ports = surface.find_entities_filtered{force=force.name,type='roboport',limit=129}
  local groups, primary, largest = {}, nil, 0
  local active = 0
  for i, port in ipairs(ports) do
    if i > 128 then break end
    local cell = port.logistic_cell
    local network = cell and cell.logistic_network
    if network then
      local id = network.network_id
      groups[id] = (groups[id] or 0) + 1
      if groups[id] > largest or (groups[id] == largest and (not primary or id < primary)) then
        primary, largest = id, groups[id]
      end
    end
    if cell and cell.transmitting and port.energy > 0 then active = active + 1 end
  end
  local network_count = 0
  for _ in pairs(groups) do network_count = network_count + 1 end
  local out = {primary_network=primary,ports=math.min(#ports,128),active_ports=active,
    fixed_networks=network_count,checked=0,excluded=0,logistic_centers=0,
    construction_covered=0,logistic_chests=0,logistic_chests_covered=0,uncovered={},
    truncated=#ports>128,tick=game.tick}
  local function inside(position, construction)
    if not primary then return false end
    if construction then
      for _, network in pairs(surface.find_logistic_networks_by_construction_area(position,force)) do
        if network.network_id == primary then return true end
      end
      return false
    end
    local network = surface.find_logistic_network_by_position(position,force)
    return network and network.network_id == primary or false
  end
  -- Add chunk pagination before raising these bounds for larger factories.
  local targets = surface.find_entities_filtered{force=force.name,limit=1001,type={
    'assembling-machine','furnace','mining-drill','roboport','lab','container',
    'logistic-container','generator','boiler','offshore-pump'}}
  if #targets > 1000 then out.truncated = true end
  for i, entity in ipairs(targets) do
    if i > 1000 then break end
    local b = entity.bounding_box
    if territories.blocked(read,b.left_top.x,b.left_top.y,b.right_bottom.x,b.right_bottom.y) then
      out.excluded = out.excluded + 1
    else
      out.checked = out.checked + 1
      local logistic = inside(entity.position,false)
      if logistic then out.logistic_centers = out.logistic_centers + 1 end
      local construction = inside(entity.position,true)
      for _, position in ipairs({
        {x=b.left_top.x+.01,y=b.left_top.y+.01},{x=b.right_bottom.x-.01,y=b.left_top.y+.01},
        {x=b.left_top.x+.01,y=b.right_bottom.y-.01},{x=b.right_bottom.x-.01,y=b.right_bottom.y-.01}}) do
        if construction and not inside(position,true) then construction = false end
      end
      if construction then out.construction_covered = out.construction_covered + 1 end
      local chest = entity.type == 'logistic-container'
      if chest then
        out.logistic_chests = out.logistic_chests + 1
        if logistic then out.logistic_chests_covered = out.logistic_chests_covered + 1 end
      end
      if #out.uncovered < 12 and (not construction or chest and not logistic) then
        out.uncovered[#out.uncovered+1] = {name=entity.name,unit_number=entity.unit_number,
          x=entity.position.x,y=entity.position.y,kind=not construction and 'construction' or 'logistic_chest'}
      end
    end
  end
  out.note = 'Current native coverage of charted unguarded/cleared machines, chests and power producers. Construction samples center and four corners; logistics counts centers and chests separately. Personal networks do not qualify. Truncation or excluded targets prevents a whole-surface claim. Active ports do not prove power headroom or material delivery.'
  return out
end

local function logistics_summary(a)
  if a.coverage ~= nil and type(a.coverage) ~= "boolean" then error("coverage must be a boolean",0) end
  local force = force_lookup.require_force(a.force)
  local surface, miss = surface_lookup.find(a.surface)
  if not surface then
    miss.force = force.name
    return miss
  end

  -- Rank on the cheap reads first, cut, and only then ask the surviving
  -- networks for their contents. A mall surface can hold dozens of one-roboport
  -- networks, and get_contents on every one of them would be paid for rows the
  -- reply was never going to carry.
  -- The whole-surface totals are summed here, over every network and before
  -- the cut, from counters the network already keeps. A sweep that wants
  -- "robots per force" reads these and never the rows: the rows are cut to a
  -- handful on purpose, a mall surface can hold dozens of one-roboport
  -- networks, and a sum over the survivors of that cut is not a total.
  local order = {}
  local logistic_total = 0
  for _, network in pairs(force.logistic_networks[surface.name] or {}) do
    logistic_total = logistic_total + network.all_logistic_robots
    order[#order + 1] = {
      network = network,
      id = network.network_id,
      robots = network.all_logistic_robots + network.all_construction_robots,
    }
  end
  table.sort(order, function(x, y)
    if x.robots ~= y.robots then return x.robots > y.robots end
    return x.id < y.id
  end)

  local picked = bounded.cut(order, bounded.limit(a.limit, DEFAULT_NETWORKS, MAX_NETWORKS))
  local rows = {}
  for i, entry in ipairs(picked) do rows[i] = network_row(entry.network, a.contents) end

  return {
    found = true,
    force = force.name,
    surface = surface.name,
    total = #order,
    shown = #rows,
    logistic_robots_total = logistic_total,
    networks = rows,
    coverage = a.coverage and coverage_report(force,surface) or nil,
  }
end

M.functions = { logistics_summary = logistics_summary }

return M
