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
    local function remember(id, chat_id, title, design, blueprint)
        for _, entry in ipairs(entries) do
            if entry.id == id then
                -- A saved artifact ID is immutable; do not replace a different design.
                return entry.blueprint == blueprint
            end
        end
        -- Retain saved entries at the limit; raise after profiling save size.
        if #entries >= 32 then return false end
        entries[#entries + 1] = {id=id, chatId=chat_id, title=title, design=design,
            blueprint=blueprint, tick=game.tick}
        changed = true
        return true
    end
    for _, artifact in ipairs(state.blueprints or {}) do
        if remember(artifact.id, artifact.chatId, artifact.title, artifact.label, artifact.blueprint) then
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
    for _, entry in ipairs(storage.books[source] or {}) do
        local found = false
        for _, other in ipairs(entries) do if other.id == entry.id then found = true; break end end
        if not found then entries[#entries + 1] = entry end
    end
    storage.books[destination.index] = entries
    storage.book_versions[destination.index] = (storage.book_versions[destination.index] or 0) + 1
    storage.books[source] = nil
    storage.book_versions[source] = nil
    storage.book_sync[source] = nil
end

return books
