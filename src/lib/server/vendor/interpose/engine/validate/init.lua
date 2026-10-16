--- Validator: placement (collisions, area) + item flow. Same code for the CLI and in-game.
local blueprint = require("engine.blueprint")
local placement = require("engine.validate.placement")
local flow = require("engine.validate.flow")

local validate = {}

local function by_entity(a, b)
  if (a.entity or 0) ~= (b.entity or 0) then
    return (a.entity or 0) < (b.entity or 0)
  end
  if a.code ~= b.code then
    return a.code < b.code
  end
  return a.message < b.message
end

--- Validate a blueprint table against a game pack.
--- opts.area: optional allowed area {{x1, y1}, {x2, y2}} in tiles.
--- opts.resources: optional ore under the blueprint, {["x,y"] = resource name} per tile, for mining drills.
--- Returns {ok = bool, errors = {...}, warnings = {...}}, each problem {code, entity, position, message}.
function validate.run(bp, pack, opts)
  local entities = type(bp) == "table" and ((type(bp.blueprint) == "table" and bp.blueprint.entities) or bp.entities)
  if type(entities) ~= "table" then
    local e = {
      code = "not-a-blueprint",
      message = "this is not a blueprint: no blueprint.entities list",
      hint = 'a blueprint looks like {"blueprint": {"entities": [...]}}; problem files go to `plan` or `solve`',
    }
    return { ok = false, errors = { e }, warnings = {} }
  end
  local model, errors = blueprint.load(bp, pack)
  -- a layout needs ports to be checked against: where items come in, and what must come out
  local has = {}
  for _, ent in ipairs(model.entities) do
    has[ent.kind] = true
  end
  if not has.output_port then
    errors[#errors + 1] = {
      code = "no-output-port",
      message = "the blueprint has no output port",
      hint = "mark the product with an output port",
    }
  end
  if not has.input_port and not has.drill then
    errors[#errors + 1] = {
      code = "no-input-port",
      message = "the blueprint has no input ports (nor mining drills)",
      hint = "mark every ingredient with an input port",
    }
  end
  local grid, placement_errors = placement.check(model, opts)
  local flow_errors, warnings = flow.check(model, pack, grid, opts and opts.resources)
  for _, list in ipairs({ placement_errors, flow_errors }) do
    for _, p in ipairs(list) do
      errors[#errors + 1] = p
    end
  end
  table.sort(errors, by_entity)
  table.sort(warnings, by_entity)
  return { ok = #errors == 0, errors = errors, warnings = warnings }
end

return validate
