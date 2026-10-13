-- Save-owned force books. Library records cannot be created through Factorio's API.
local books = {}

function books.init()
    storage.books = storage.books or {}
    storage.book_versions = storage.book_versions or {}
end

function books.list(force)
    return storage.books[force.index] or {}
end

function books.remember(player, state)
    if not state.current or not state.blueprint then return end
    local entries = books.list(player.force)
    local existing
    for _, entry in ipairs(entries) do if entry.id == state.current then existing = entry; break end end
    if existing and existing.blueprint == state.blueprint then return end
    -- Retain all saved entries at the limit; raise after profiling save size.
    if not existing and #entries >= 32 then return false end
    if not existing then existing = {id=state.current};entries[#entries + 1] = existing end
    local title = state.design or 'Toby design'
    for _, chat in ipairs(state.chats) do if chat.id == state.current then title = chat.title; break end end
    existing.title = title
    existing.design = state.design or title
    existing.blueprint = state.blueprint
    existing.tick = game.tick
    storage.books[player.force.index] = entries
    storage.book_versions[player.force.index] = (storage.book_versions[player.force.index] or 0) + 1
    return true
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
    local items, version, bytes = {}, nil, 0
    for i, entry in ipairs(entries) do
        local data, size = decode(entry.blueprint)
        bytes = bytes + size
        if bytes > 2000000 then error('Toby book exceeds the supported size; take individual designs instead', 0) end
        local blueprint = data.blueprint or data.blueprint_book
        version = blueprint.version
        data.index = 0
        items[#items + 1] = {index=i - 1, blueprint_book={item='blueprint-book', label=entry.title,
            description='Toby · ' .. entry.design, version=version, active_index=0, blueprints={data}}}
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
end

return books
