--- Interpose engine: pure Lua 5.2, no game globals. JSON-shaped tables in, tables out.
--- The CLI and the mod both call this module, so they produce identical results.
local engine = {}

engine.VERSION = "0.0.1"

engine.fraction = require("engine.model.fraction")
engine.issues = require("engine.issues")
engine.ratios = require("engine.ratios")
engine.blueprint = require("engine.blueprint")
engine.problem = require("engine.problem")
engine.rows = require("engine.placement.rows")
engine.routing = require("engine.routing.init")
engine.score = require("engine.score")
engine.blueprint_string = require("engine.codec.blueprint_string")
engine.power = require("engine.power") -- M11: poles for a layout, and joining poles
engine.fluids = require("engine.fluids") -- M13: pipes, fluids never touching

local solve = require("engine.solve")

--- Solve a problem (table) into a routed, validated blueprint. See engine/solve.lua.
function engine.solve(problem, pack)
  if type(problem) == "table" and problem.kind == "fluid" then
    return engine.fluids.solve(problem, pack)
  end
  if type(problem) == "table" and problem.auto_inputs then
    return solve.run_auto(problem, pack)
  end
  return solve.run(problem, pack)
end

--- M9e: candidate problems for an output-only problem (engine/auto.lua).
engine.auto = require("engine.auto")

--- The same, in steps (the game spreads a solve over ticks): job_new(problem) makes a job (plain
--- data), job_step(job, pack, budget) works on it for up to `budget` search steps and returns the
--- steps used. When job.done: job.result, or nil and job.errors, as engine.solve returns them.
function engine.job_new(problem)
  return solve.job_new(problem)
end

function engine.job_step(job, pack, budget)
  return solve.job_step(job, pack, budget)
end

local validate = require("engine.validate.init")

--- Validate a blueprint (table) against a game pack. See engine/validate/init.lua.
function engine.validate(bp, pack, opts)
  return validate.run(bp, pack, opts)
end

return engine
