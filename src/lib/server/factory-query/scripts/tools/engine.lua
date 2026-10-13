-- AI Agent Bridge - scripts/tools/engine.lua
-- Author: bits-orio
-- License: MIT
--
-- The companion's own tool provider: engine reads exposed as agent_tools_v1
-- tools on the "ai-agent-bridge-tools" interface. Discovered by
-- scripts/probe.lua the same way any other mod's tools are, because the
-- companion is a provider like everyone else (CONTEXT.md "Provider").
--
-- Wiring only. Each module below owns one group of tools and declares both a
-- `manifest` and a `functions` table keyed by the same names; adding a tool
-- means adding a module here, never editing this file's body.

-- Keep source ownership beside the native contracts so the service can send only
-- the modules needed for a lookup; implementations and scope checks stay native.
local MODULES = {
  "scripts.tools.basics", "scripts.tools.surfaces", "scripts.tools.production",
  "scripts.tools.production_since", "scripts.tools.research", "scripts.tools.tech_status",
  "scripts.tools.logistics", "scripts.tools.entity_count", "scripts.tools.environment",
  "scripts.tools.rockets", "scripts.tools.game_time", "scripts.tools.locate",
  "scripts.tools.kills", "scripts.tools.built", "scripts.tools.fluid_rate", "scripts.tools.trains",
  "scripts.tools.machine_diagnostics", "scripts.tools.transport_diagnostics",
  "scripts.tools.power_diagnostics", "scripts.tools.train_diagnostics",
  "scripts.tools.logistic_requests", "scripts.tools.planning", "scripts.tools.transport_route",
  "scripts.tools.bus_discovery", "scripts.tools.resources", "scripts.sweep.tool",
}

local INTERFACE = "ai-agent-bridge-tools"

local MANIFEST = {}
local FUNCTIONS = {}

for _, module_name in ipairs(MODULES) do
  local module = require(module_name)
  for name, entry in pairs(module.manifest) do
    local fn = module.functions[name]
    -- A manifest entry with no function would advertise a tool that always
    -- answers no_tool. Fail at load instead, where it is obvious.
    if type(fn) ~= "function" then
      error("[ai-agent-bridge] tool " .. name .. " is in a manifest with no function behind it")
    end
    -- The original companion injected force; Facmandu requires callers to select it explicitly.
    entry.params = entry.params or {}
    entry.params.force = name == "list_forces"
      and "string optional asking force, defaults to player"
      or "string! exact force name returned by list_forces"
    entry.module = module_name
    MANIFEST[name] = entry
    FUNCTIONS[name] = fn
  end
end

FUNCTIONS.agent_tools_v1 = function() return { v = 1, tools = MANIFEST } end

local planners = require("scripts.tools.mod_planners")
local M = {}

function M.register(native_remote)
  local provider = planners.provider(native_remote)
  for name, entry in pairs(provider.manifest) do
    entry.params.force = "string! exact asking force name"
    entry.module = "scripts.tools.mod_planners"
    MANIFEST[name] = entry
    FUNCTIONS[name] = provider.functions[name]
  end
  remote.add_interface(INTERFACE, FUNCTIONS)
end

return M
