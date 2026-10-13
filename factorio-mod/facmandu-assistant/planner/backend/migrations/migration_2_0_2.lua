local events = require('events').scope('planner')
---@diagnostic disable

local migration = {}

function migration.global()
    for tick, _ in pairs(storage.planner.nth_tick_events) do events.on_nth_tick(tick, nil) end
    storage.planner.nth_tick_events = {}  -- reset because some bad data ended up in there
end

return migration
