local PORT = "platform-logistics-port"
local ROBOT = "platform-logistics-robot"

local function foundations()
  local names = {}
  for name, prototype in pairs(prototypes.tile) do
    if prototype.is_foundation then
      names[#names + 1] = name
    end
  end
  return names
end

local function chunk_key(x, y)
  return x .. ":" .. y
end

local function remove_port(port, hub)
  local inventory = port.get_inventory(defines.inventory.roboport_robot)
  local automatic = inventory.get_item_count(ROBOT)
  if automatic > 0 then
    inventory.remove {name = ROBOT, count = automatic}
  end
  -- Other mods can send player-owned robots here. Return them without loss.
  for index = 1, #inventory do
    local stack = inventory[index]
    if stack.valid_for_read then
      local inserted = hub.insert(stack)
      if inserted == stack.count then
        stack.clear()
      elseif inserted > 0 then
        stack.count = stack.count - inserted
      end
    end
  end
  if inventory.is_empty() then
    port.destroy()
    return true
  end
  -- A full hub must not delete player-owned stock; retry on the next scan.
  return false
end

local function reconcile_chunk(surface, x, y)
  if not surface.platform or not surface.platform.hub then
    return
  end
  local ports = storage.platform_ports[surface.index]
  if not ports then
    ports = {}
    storage.platform_ports[surface.index] = ports
  end
  local key = chunk_key(x, y)
  local port = ports[key]
  local tiles = surface.find_tiles_filtered {
    area = {{x * 32, y * 32}, {(x + 1) * 32 - 0.01, (y + 1) * 32 - 0.01}},
    name = storage.foundation_names,
    limit = 1,
  }
  if not tiles[1] then
    -- Flying robots retain their cargo and can return to the remaining cells.
    if port and port.valid then
      if not remove_port(port, surface.platform.hub) then
        return
      end
    end
    ports[key] = nil
    return
  end
  if port and port.valid then
    port.force = surface.platform.force
    -- Foundation may have been removed underneath this otherwise occupied chunk.
    if not surface.get_tile(port.position).prototype.is_foundation then
      port.teleport {tiles[1].position.x + 0.5, tiles[1].position.y + 0.5}
    end
    return
  end
  port = surface.create_entity {
    name = PORT,
    position = {tiles[1].position.x + 0.5, tiles[1].position.y + 0.5},
    force = surface.platform.force,
    create_build_effect_smoke = false,
  }
  assert(port, "Could not create automatic platform logistic cell")
  port.destructible = false
  ports[key] = port
end

local function scan_surface(surface)
  if surface.platform then
    for chunk in surface.get_chunks() do
      reconcile_chunk(surface, chunk.x, chunk.y)
    end
  end
end

local function initialize()
  storage.platform_ports = storage.platform_ports or {}
  storage.foundation_names = foundations()
  -- Recover existing cells without replacing their inventories or robot jobs.
  for _, surface in pairs(game.surfaces) do
    if surface.platform then
      local ports = storage.platform_ports[surface.index] or {}
      storage.platform_ports[surface.index] = ports
      for _, port in pairs(surface.find_entities_filtered {name = PORT}) do
        ports[chunk_key(math.floor(port.position.x / 32), math.floor(port.position.y / 32))] = port
      end
      scan_surface(surface)
    end
  end
end

local function tiles_changed(event)
  local surface = game.surfaces[event.surface_index]
  if not surface or not surface.platform then
    return
  end
  local chunks = {}
  for _, tile in pairs(event.tiles) do
    local p = tile.position
    local x, y = math.floor(p.x / 32), math.floor(p.y / 32)
    local key = chunk_key(x, y)
    if not chunks[key] then
      chunks[key] = true
      reconcile_chunk(surface, x, y)
    end
  end
end

script.on_init(initialize)
script.on_configuration_changed(initialize)
script.on_event(defines.events.on_surface_created, function(event)
  scan_surface(game.surfaces[event.surface_index])
end)
script.on_event(defines.events.on_surface_deleted, function(event)
  storage.platform_ports[event.surface_index] = nil
end)
script.on_event(defines.events.on_space_platform_built_entity, function(event)
  if event.entity.type == "space-platform-hub" then
    scan_surface(event.entity.surface)
  end
end)
script.on_event({
  defines.events.on_space_platform_built_tile,
  defines.events.on_space_platform_mined_tile,
  defines.events.on_player_built_tile,
  defines.events.on_player_mined_tile,
  defines.events.on_robot_built_tile,
  defines.events.on_robot_mined_tile,
  defines.events.script_raised_set_tiles,
}, tiles_changed)

-- Also reconcile script-created platforms and foundation lost to asteroid damage.
script.on_nth_tick(600, function()
  for _, surface in pairs(game.surfaces) do
    scan_surface(surface)
  end
end)

script.on_nth_tick(60, function()
  local seen = {}
  for surface_index, ports in pairs(storage.platform_ports) do
    local surface = game.surfaces[surface_index]
    if surface and surface.platform and surface.platform.hub then
      for key, port in pairs(ports) do
        if port.valid then
          port.force = surface.platform.force
          local cell = port.logistic_cell
          local network = cell and cell.logistic_network
          if cell and cell.transmitting and network and not seen[network.network_id] then
            seen[network.network_id] = true
            local charging_queue = 0
            for _, member in pairs(network.cells) do
              charging_queue = charging_queue + member.to_charge_robot_count
            end
            if network.available_logistic_robots == 0 and charging_queue == 0 then
              -- Grow only when every robot is busy; an idle reserve stops growth.
              port.get_inventory(defines.inventory.roboport_robot).insert {
                name = ROBOT,
                count = math.max(1, math.ceil(network.all_logistic_robots / 4)),
              }
            else
              local reserve = 1
              for _, member in pairs(network.cells) do
                local owner = member.owner
                if owner.name == PORT then
                  local inventory = owner.get_inventory(defines.inventory.roboport_robot)
                  local count = inventory.get_item_count(ROBOT)
                  local keep = math.min(reserve, count)
                  if count > keep then
                    inventory.remove {name = ROBOT, count = count - keep}
                  end
                  reserve = reserve - keep
                end
              end
            end
          end
        else
          ports[key] = nil
        end
      end
    else
      for _, port in pairs(ports) do
        if port.valid then
          port.destroy()
        end
      end
      storage.platform_ports[surface_index] = nil
    end
  end
end)
