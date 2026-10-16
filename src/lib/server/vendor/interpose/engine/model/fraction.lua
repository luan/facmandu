--- Exact rational numbers for ratio maths. Values are immutable.
--- Numerator and denominator are integers held in Lua numbers (exact up to 2^53).
local fraction = {}

local mt = {}
mt.__index = fraction
-- the mod registers it (script.register_metatable), so fractions survive in the game's storage
fraction.metatable = mt

local function gcd(a, b)
  a, b = math.abs(a), math.abs(b)
  while b ~= 0 do
    a, b = b, a % b
  end
  return a
end

local function is_integer(x)
  return type(x) == "number" and x == math.floor(x) and x == x and math.abs(x) < 2 ^ 53
end

--- Create a fraction n/d in lowest terms with a positive denominator.
---@param n number integer numerator
---@param d number|nil integer denominator, default 1
function fraction.new(n, d)
  d = d or 1
  assert(is_integer(n), "fraction numerator must be an integer")
  assert(is_integer(d), "fraction denominator must be an integer")
  assert(d ~= 0, "fraction denominator must not be zero")
  if d < 0 then
    n, d = -n, -d
  end
  local g = gcd(n, d)
  if g > 1 then
    n, d = n / g, d / g
  end
  return setmetatable({ n = n, d = d }, mt)
end

function fraction.is(x)
  return getmetatable(x) == mt
end

--- Convert a number or decimal string to a fraction exactly ("0.5" -> 1/2, 0.75 -> 3/4).
--- Numbers go through their shortest decimal form, so 0.1 becomes 1/10, not a binary approximation.
function fraction.from(x)
  if fraction.is(x) then
    return x
  end
  local s = type(x) == "number" and string.format("%.15g", x) or x
  assert(type(s) == "string", "fraction.from expects a number, string or fraction")
  local num, den = s:match("^%s*(-?%d+)%s*/%s*(%d+)%s*$")
  if num then
    return fraction.new(tonumber(num) --[[@as number]], tonumber(den) --[[@as number]])
  end
  local sign, int, dec = s:match("^%s*(-?)(%d*)%.?(%d*)%s*$")
  assert(int and (int ~= "" or dec ~= ""), "not a number: " .. tostring(x))
  local n = tonumber((int ~= "" and int or "0") .. dec) --[[@as number]]
  local f = fraction.new(n, 10 ^ #dec)
  return sign == "-" and -f or f
end

local function lift(a, b)
  return fraction.from(a), fraction.from(b)
end

function mt.__add(a, b)
  a, b = lift(a, b)
  return fraction.new(a.n * b.d + b.n * a.d, a.d * b.d)
end

function mt.__sub(a, b)
  a, b = lift(a, b)
  return fraction.new(a.n * b.d - b.n * a.d, a.d * b.d)
end

function mt.__mul(a, b)
  a, b = lift(a, b)
  return fraction.new(a.n * b.n, a.d * b.d)
end

function mt.__div(a, b)
  a, b = lift(a, b)
  assert(b.n ~= 0, "division by zero")
  return fraction.new(a.n * b.d, a.d * b.n)
end

function mt.__unm(a)
  return fraction.new(-a.n, a.d)
end

function mt.__eq(a, b)
  return a.n == b.n and a.d == b.d
end

function mt.__lt(a, b)
  a, b = lift(a, b)
  return a.n * b.d < b.n * a.d
end

function mt.__le(a, b)
  a, b = lift(a, b)
  return a.n * b.d <= b.n * a.d
end

-- %d, not tostring: in Lua 5.3+ division makes floats ("3.0"), and the output must not depend on the version
function mt.__tostring(a)
  if a.d == 1 then
    return string.format("%d", a.n)
  end
  return string.format("%d/%d", a.n, a.d)
end

--- Smallest integer >= the fraction.
function fraction.ceil(a)
  return math.ceil(a.n / a.d) -- exact: the quotient of two exact integers rounds correctly here
end

function fraction.to_number(a)
  return a.n / a.d
end

return fraction
