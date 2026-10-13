-- Save-owned force books. Library records cannot be created through Factorio's API.
local books = {}

function books.init()
    storage.books = storage.books or {}
    storage.book_versions = storage.book_versions or {}
    storage.book_sync = storage.book_sync or {}
end

function books.list(force)
    return storage.books[force.index] or {}
end

function books.remember(player, state)
    books.init()
    local entries = books.list(player.force)
    local accepted, pending, changed = {}, 0, false
    local function remember(id, chat_id, title, design, blueprint, design_id, revision_of)
        local matched, matched_record, parent, parent_record, child
        for _, entry in ipairs(entries) do
            if entry.id == id then
                if entry.blueprint ~= blueprint then return false end
                matched, matched_record = entry, entry
            end
            local records = {entry}
            for _, record in ipairs(entry.lineage or {}) do records[#records + 1] = record end
            for _, record in ipairs(records) do
                if record ~= entry and record.id == id then matched, matched_record = entry, record end
                if revision_of and record.designId == revision_of then parent, parent_record = entry, record end
                if design_id and record.revisionOf == design_id then child = entry end
            end
        end
        for _, entry in pairs{matched=matched, parent=parent, child=child} do
            if (entry.chatId or entry.id) ~= chat_id then return false end
        end
        if matched_record then
            if matched_record.designId and design_id and matched_record.designId ~= design_id then return false end
            if matched_record.revisionOf and revision_of and matched_record.revisionOf ~= revision_of then return false end
            design_id = design_id or matched_record.designId
            revision_of = revision_of or matched_record.revisionOf
        end
        -- A new branch cannot replace a revision that has already been superseded.
        if parent and parent_record ~= parent and not matched and not child then return false end
        if child and parent == child and parent_record == parent then return false end

        local target = child or matched or parent
        local latest = not child and (not matched or matched_record == matched)
        if not target and #entries >= 32 then return false end
        local lineage = {}
        local function retain(record)
            for _, existing in ipairs(lineage) do if existing.id == record.id then return end end
            lineage[#lineage + 1] = {id=record.id, designId=record.designId, revisionOf=record.revisionOf}
        end
        for _, record in ipairs(target and target.lineage or {}) do retain(record) end
        if target and latest and target.id ~= id then retain(target) end
        if not latest then retain{id=id, designId=design_id, revisionOf=revision_of} end
        for _, older in pairs{parent=parent, matched=matched} do
            if older ~= target then
                retain(older)
                for _, record in ipairs(older.lineage or {}) do retain(record) end
            end
        end
        -- Keep replay ancestry bounded; raise after profiling long-lived save size.
        if #lineage > 64 then return false end
        if not target then
            target = {}
            entries[#entries + 1] = target
        end
        if latest then
            target.id, target.chatId, target.title, target.design = id, chat_id, title, design
            target.blueprint, target.tick = blueprint, game.tick
            target.designId, target.revisionOf = design_id, revision_of
        end
        for _, record in ipairs(lineage) do
            if record.id == id then record.designId, record.revisionOf = design_id, revision_of end
        end
        target.lineage = lineage
        for index = #entries, 1, -1 do
            local entry = entries[index]
            if entry ~= target and (entry == parent or entry == matched) then table.remove(entries, index) end
        end
        changed = true
        return true
    end
    for _, artifact in ipairs(state.blueprints or {}) do
        if remember(artifact.id, artifact.chatId, artifact.title, artifact.label, artifact.blueprint,
                artifact.designId, artifact.revisionOf) then
            accepted[#accepted + 1] = artifact.id
        else pending = pending + 1 end
    end
    -- Legacy draft packets have no artifact IDs. Keep them separate from completed designs.
    if not state.blueprints and state.current and state.blueprint and state.designStage ~= 'Inspection' then
        local title = state.design or 'Toby design'
        for _, chat in ipairs(state.chats) do if chat.id == state.current then title = chat.title; break end end
        local existing
        for _, entry in ipairs(entries) do if entry.id == state.current then existing = entry; break end end
        if existing and existing.blueprint ~= state.blueprint then
            existing.blueprint = state.blueprint;existing.design = state.design or title;existing.title = title
            changed = true
        elseif not existing and not remember(state.current, state.current, title, state.design or title, state.blueprint) then
            pending = pending + 1
        end
    end
    if storage.book_sync[player.force.index] ~= pending then changed = true end
    storage.book_sync[player.force.index] = pending
    storage.books[player.force.index] = entries
    if changed then storage.book_versions[player.force.index] = (storage.book_versions[player.force.index] or 0) + 1 end
    return {blueprints=accepted}
end

local function decode(source)
    local decoded = helpers.decode_string(source:sub(2))
    if not decoded or #decoded > 2000000 then error('Blueprint book exceeds the supported size', 0) end
    local data = helpers.json_to_table(decoded)
    if not data or not (data.blueprint or data.blueprint_book) then error('Invalid blueprint book entry', 0) end
    return data, #decoded
end

function books.export(force)
    local entries = books.list(force)
    if #entries == 0 then error('No saved Toby designs on this force yet', 0) end
    local items, groups, version, bytes = {}, {}, nil, 0
    for _, entry in ipairs(entries) do
        local data, size = decode(entry.blueprint)
        bytes = bytes + size
        if bytes > 2000000 then error('Toby book exceeds the supported size; take individual designs instead', 0) end
        local blueprint = data.blueprint or data.blueprint_book
        version = blueprint.version
        local chat_id = entry.chatId or entry.id
        local group = groups[chat_id]
        if not group then
            group = {index=#items, blueprint_book={item='blueprint-book', label=entry.title,
                description='Toby designs', version=version, active_index=0, blueprints={}}}
            groups[chat_id] = group
            items[#items + 1] = group
        end
        blueprint.label = entry.design
        data.index = #group.blueprint_book.blueprints
        group.blueprint_book.blueprints[#group.blueprint_book.blueprints + 1] = data
    end
    return '0' .. helpers.encode_string(helpers.table_to_json({blueprint_book={item='blueprint-book',
        label='Toby · ' .. force.name, description='Shared Toby designs · Save this book in Game blueprints.',
        version=version, active_index=0, blueprints=items}}))
end

function books.take(player, update)
    if not player.cursor_stack then error('Your character must be available to take a book', 0) end
    local source = books.export(player.force)
    if update then
        local cursor = player.cursor_stack
        if not cursor or not cursor.valid_for_read or not cursor.is_blueprint_book then
            error('Hold a blueprint book to add the current Toby designs', 0)
        end
        local held = decode(cursor.export_stack())
        local latest = decode(source)
        local items = held.blueprint_book.blueprints or {}
        local index = 0
        for _, item in pairs(items) do index = math.max(index, item.index + 1) end
        -- Append a snapshot; never replace user-edited records in the held book.
        latest.index = index
        latest.blueprint_book.label = 'Toby updates'
        items[#items + 1] = latest
        held.blueprint_book.blueprints = items
        local json = helpers.table_to_json(held)
        if #json > 2000000 then error('Updated book exceeds the supported size; take a separate Toby book', 0) end
        source = '0' .. helpers.encode_string(json)
    end
    local inventory = game.create_inventory(1)
    local ok, result = pcall(function()
        if inventory[1].import_stack(source) ~= 0 then error('Factorio could not import the Toby book', 0) end
        if not update and not player.clear_cursor() then error('Clear inventory space before taking the book', 0) end
        if not player.cursor_stack.swap_stack(inventory[1]) then error('Could not put the book in your cursor', 0) end
    end)
    inventory.destroy()
    if not ok then error(result, 0) end
    return true
end

function books.merge(source, destination)
    books.init()
    local entries = books.list(destination)
    local function contains(entry, id)
        if entry.id == id then return true end
        for _, record in ipairs(entry.lineage or {}) do if record.id == id then return true end end
        return false
    end
    local function retain_ancestry(current, older)
        current.lineage = current.lineage or {}
        local records = {older}
        for _, record in ipairs(older.lineage or {}) do records[#records + 1] = record end
        for _, record in ipairs(records) do
            if not contains(current, record.id) then
                current.lineage[#current.lineage + 1] = {id=record.id, designId=record.designId, revisionOf=record.revisionOf}
            end
        end
    end
    for _, entry in ipairs(storage.books[source] or {}) do
        local found = false
        for _, other in ipairs(entries) do
            if contains(other, entry.id) then retain_ancestry(other, entry);found = true;break end
        end
        if not found then
            for index = #entries, 1, -1 do
                if contains(entry, entries[index].id) then
                    retain_ancestry(entry, entries[index]);table.remove(entries, index)
                end
            end
        end
        if not found then entries[#entries + 1] = entry end
    end
    storage.books[destination.index] = entries
    storage.book_versions[destination.index] = (storage.book_versions[destination.index] or 0) + 1
    storage.books[source] = nil
    storage.book_versions[source] = nil
    storage.book_sync[source] = nil
end

return books
