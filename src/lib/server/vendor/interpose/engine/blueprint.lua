--- Blueprint JSON (as tables) -> internal model with entity kinds, tile footprints and directions.
--- Accepts {blueprint = {entities = {...}}} or {entities = {...}}.
local direction = require("engine.model.direction")

local blueprint = {}

blueprint.INPUT_PORT = "interpose-input-port"
blueprint.OUTPUT_PORT = "interpose-output-port"
blueprint.PORT_ITEM_TAG = "interpose_item"

local EPS = 1e-6

--- Tile key for a tile's integer coordinates.
function blueprint.tile_key(tx, ty)
  return tx .. "," .. ty
end

local function kind_of(name, pack)
  if name == blueprint.INPUT_PORT then
    return "input_port", { size = { 1, 1 } }
  elseif name == blueprint.OUTPUT_PORT then
    return "output_port", { size = { 1, 1 } }
  end
  for _, k in ipairs({
    { "machines", "machine" },
    { "belts", "belt" },
    { "undergrounds", "underground" },
    { "splitters", "splitter" },
    { "inserters", "inserter" },
    { "drills", "drill" },
    { "furnaces", "furnace" },
    { "poles", "pole" },
    { "chests", "chest" },
  }) do
    local proto = pack[k[1]] and pack[k[1]][name]
    if proto then
      return k[2], proto
    end
  end
  return nil, nil
end

local function snap(v)
  local r = math.floor(v + 0.5)
  if math.abs(v - r) < EPS then
    return r
  end
  return nil
end

--- Build the model. Returns model, problems (list of {code, message, entity, position}).
function blueprint.load(bp, pack)
  local list = (bp.blueprint and bp.blueprint.entities) or bp.entities or {}
  local model = { entities = {}, by_id = {} }
  local problems = {}
  local function problem(code, e, message)
    problems[#problems + 1] = { code = code, entity = e.entity_number, position = e.position, message = message }
  end

  for i, e in ipairs(type(list) == "table" and list or {}) do
    local well_formed = type(e) == "table"
      and type(e.name) == "string"
      and type(e.position) == "table"
      and type(e.position.x) == "number"
      and type(e.position.y) == "number"
    local kind, proto
    if well_formed then
      kind, proto = kind_of(e.name, pack)
    end
    local dir = well_formed and e.direction or direction.NORTH
    if not well_formed then
      problems[#problems + 1] = {
        code = "bad-entity",
        entity = type(e) == "table" and e.entity_number or nil,
        message = "entity " .. i .. " has no name or position",
      }
    elseif not kind then
      problem("unknown-entity", e, "unknown entity " .. tostring(e.name))
    elseif not direction.is_cardinal(dir) then
      problem("bad-direction", e, "direction " .. tostring(dir) .. " is not north, east, south or west")
    else
      ---@cast proto -nil
      local w, h = proto.size[1], proto.size[2]
      if dir == direction.EAST or dir == direction.WEST then
        w, h = h, w
      end
      local tx, ty = snap(e.position.x - w / 2), snap(e.position.y - h / 2)
      if not (tx and ty) then
        problem("off-grid", e, string.format("%s is not aligned to the tile grid", e.name))
      else
        local ent = {
          id = e.entity_number,
          name = e.name,
          kind = kind,
          proto = proto,
          x = e.position.x,
          y = e.position.y,
          dir = dir,
          tx = tx,
          ty = ty,
          w = w,
          h = h,
          recipe = e.recipe,
          pickup_position = e.pickup_position,
          drop_position = e.drop_position,
          io = e.type, -- underground belts: "input" or "output"
          item = e.tags and e.tags[blueprint.PORT_ITEM_TAG],
        }
        ent.tiles = {}
        for dx = 0, w - 1 do
          for dy = 0, h - 1 do
            ent.tiles[#ent.tiles + 1] = { tx + dx, ty + dy }
          end
        end
        if (kind == "input_port" or kind == "output_port") and not ent.item then
          problem("port-without-item", e, e.name .. " has no item (tag " .. blueprint.PORT_ITEM_TAG .. ")")
        end
        if kind == "underground" and ent.io ~= "input" and ent.io ~= "output" then
          problem("underground-type", e, "underground belt needs type input or output")
        end
        if type(ent.id) ~= "number" then
          problem("missing-id", e, e.name .. " has no entity_number")
        elseif model.by_id[ent.id] then
          problem("duplicate-id", e, "entity_number " .. tostring(ent.id) .. " used twice")
        else
          model.entities[#model.entities + 1] = ent
          model.by_id[ent.id] = ent
        end
      end
    end
  end
  table.sort(model.entities, function(a, b)
    return a.id < b.id
  end)
  return model, problems
end

return blueprint
