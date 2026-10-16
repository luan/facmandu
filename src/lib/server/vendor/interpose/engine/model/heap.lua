--- Binary min-heap with deterministic ties: ordered by (key, insertion order).
local heap = {}
heap.__index = heap

function heap.new()
  return setmetatable({ items = {}, n = 0, counter = 0 }, heap)
end

local function less(a, b)
  if a.key ~= b.key then
    return a.key < b.key
  end
  return a.seq < b.seq
end

function heap:push(key, value)
  self.counter = self.counter + 1
  self.n = self.n + 1
  local items, i = self.items, self.n
  items[i] = { key = key, seq = self.counter, value = value }
  while i > 1 do
    local p = math.floor(i / 2)
    if less(items[i], items[p]) then
      items[i], items[p] = items[p], items[i]
      i = p
    else
      break
    end
  end
end

function heap:pop()
  if self.n == 0 then
    return nil
  end
  local items = self.items
  local top = items[1]
  items[1] = items[self.n]
  items[self.n] = nil
  self.n = self.n - 1
  local i = 1
  while true do
    local l, r, m = 2 * i, 2 * i + 1, i
    if l <= self.n and less(items[l], items[m]) then
      m = l
    end
    if r <= self.n and less(items[r], items[m]) then
      m = r
    end
    if m == i then
      break
    end
    items[i], items[m] = items[m], items[i]
    i = m
  end
  return top.value, top.key
end

function heap:empty()
  return self.n == 0
end

return heap
