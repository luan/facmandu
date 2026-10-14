-- Integrate the linear day/dusk/night/dawn curve; storage covers its power deficit.
local solar = {}

function solar.profile(day)
    local dusk = day.dusk or 0.25
    local evening = day.evening or 0.45
    local morning = day.morning or 0.55
    local dawn = day.dawn or 0.75
    local ramps = evening - dusk + dawn - morning
    local night = morning - evening
    local average = 1 - night - ramps / 2
    local storage_seconds = (night + ramps * average / 2) * (day.ticks_per_day or 25000) / 60
    if day.freeze_daytime then
        local time = (day.daytime or 0) % 1
        if time < dusk or time >= dawn then average = 1
        elseif time < evening then average = (evening - time) / (evening - dusk)
        elseif time < morning then average = 0
        else average = (time - morning) / (dawn - morning) end
        storage_seconds = average == 1 and 0 or math.huge
    end
    return average, storage_seconds
end

function solar.storage_power(capacity, input_limit, output_limit, average, seconds)
    if seconds <= 0 or average <= 0 then return 0 end
    local charge_limit = average == 1 and math.huge or input_limit * average / (1 - average)
    return math.min(capacity / seconds, output_limit, charge_limit)
end

return solar
