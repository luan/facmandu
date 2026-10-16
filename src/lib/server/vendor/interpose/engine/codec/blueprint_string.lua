--- Factorio blueprint strings: "0" (version) + base64( zlib( JSON ) ).
--- Pure Lua without bit operators, so it runs on Lua 5.2 (Factorio) and 5.3/5.4 (CLI) alike.
---   decode(text) -> json text, or nil + message
---   encode(json text) -> blueprint string (zlib with stored blocks: valid, not compressed)
--- Inflate follows RFC 1950 (zlib) and RFC 1951 (deflate): stored, fixed and dynamic Huffman blocks.
local codec = {}

local B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
local B64_INDEX = {}
for i = 1, #B64 do
  B64_INDEX[B64:sub(i, i)] = i - 1
end

local function floor(x)
  return math.floor(x)
end

--- base64 text -> list of byte values
local function base64_decode(text)
  local bytes, n = {}, 0
  local acc, bits = 0, 0
  for i = 1, #text do
    local c = text:sub(i, i)
    if c == "=" then
      break
    end
    local v = B64_INDEX[c]
    if v == nil then
      return nil, "not base64 (character " .. string.format("%q", c) .. " at " .. i .. ")"
    end
    acc, bits = acc * 64 + v, bits + 6
    if bits >= 8 then
      bits = bits - 8
      local p = 2 ^ bits
      local byte = floor(acc / p)
      acc = acc - byte * p
      n = n + 1
      bytes[n] = byte
    end
  end
  return bytes
end

local function base64_encode(bytes)
  local out = {}
  for i = 1, #bytes, 3 do
    local a, b, c = bytes[i], bytes[i + 1], bytes[i + 2]
    local v = a * 65536 + (b or 0) * 256 + (c or 0)
    local c1, c2 = floor(v / 262144) % 64, floor(v / 4096) % 64
    local c3, c4 = floor(v / 64) % 64, v % 64
    out[#out + 1] = B64:sub(c1 + 1, c1 + 1)
      .. B64:sub(c2 + 1, c2 + 1)
      .. (b and B64:sub(c3 + 1, c3 + 1) or "=")
      .. (c and B64:sub(c4 + 1, c4 + 1) or "=")
  end
  return table.concat(out)
end

local function adler32(bytes)
  local a, b = 1, 0
  for i = 1, #bytes do
    a = (a + bytes[i]) % 65521
    b = (b + a) % 65521
  end
  return b * 65536 + a
end

-- deflate tables (RFC 1951, 3.2.5)
local LEN_BASE =
  { 3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258 }
local LEN_EXTRA = { 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0 }
local DIST_BASE = {
  1,
  2,
  3,
  4,
  5,
  7,
  9,
  13,
  17,
  25,
  33,
  49,
  65,
  97,
  129,
  193,
  257,
  385,
  513,
  769,
  1025,
  1537,
  2049,
  3073,
  4097,
  6145,
  8193,
  12289,
  16385,
  24577,
}
local DIST_EXTRA = { 0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13 }
local CL_ORDER = { 16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15 }

--- Canonical Huffman table from code lengths (index = symbol + 1): map[len][code] = symbol.
local function huffman(lengths)
  local count, max = {}, 0
  for _, len in ipairs(lengths) do
    if len > 0 then
      count[len] = (count[len] or 0) + 1
      max = math.max(max, len)
    end
  end
  local next_code, code = {}, 0
  for len = 1, max do
    code = (code + (count[len - 1] or 0)) * 2
    next_code[len] = code
  end
  local map = {}
  for sym = 0, #lengths - 1 do
    local len = lengths[sym + 1]
    if len > 0 then
      map[len] = map[len] or {}
      map[len][next_code[len]] = sym
      next_code[len] = next_code[len] + 1
    end
  end
  return { map = map, max = max }
end

local FIXED_LIT, FIXED_DIST
do
  local l = {}
  for i = 0, 287 do
    l[i + 1] = (i < 144 and 8) or (i < 256 and 9) or (i < 280 and 7) or 8
  end
  FIXED_LIT = huffman(l)
  local d = {}
  for i = 1, 30 do
    d[i] = 5
  end
  FIXED_DIST = huffman(d)
end

--- Inflate a zlib stream (list of bytes). Returns list of bytes, or nil + message.
local function inflate(bytes)
  if #bytes < 6 then
    return nil, "too short for zlib"
  end
  local cmf, flg = bytes[1], bytes[2]
  if cmf % 16 ~= 8 or (cmf * 256 + flg) % 31 ~= 0 then
    return nil, "not a zlib stream"
  end
  if floor(flg / 32) % 2 == 1 then
    return nil, "zlib preset dictionaries are not supported"
  end
  local pos, cur, nbits = 3, 0, 0
  local function bit()
    if nbits == 0 then
      cur = bytes[pos]
      if cur == nil then
        error({ inflate = "unexpected end of data" }, 0)
      end
      pos, nbits = pos + 1, 8
    end
    local b = cur % 2
    cur, nbits = (cur - b) / 2, nbits - 1
    return b
  end
  local function bits(n)
    local v, p = 0, 1
    for _ = 1, n do
      v, p = v + bit() * p, p * 2
    end
    return v
  end
  local function symbol(t)
    local code = 0
    for len = 1, t.max do
      code = code * 2 + bit()
      local row = t.map[len]
      if row and row[code] then
        return row[code]
      end
    end
    error({ inflate = "bad Huffman code" }, 0)
  end

  local out, n = {}, 0
  local ok, err = pcall(function()
    repeat
      local final = bit()
      local btype = bits(2)
      if btype == 0 then
        nbits = 0 -- skip to the byte boundary
        if not bytes[pos + 3] then
          error({ inflate = "unexpected end of data" }, 0)
        end
        local len = bytes[pos] + bytes[pos + 1] * 256
        local nlen = bytes[pos + 2] + bytes[pos + 3] * 256
        if len + nlen ~= 65535 then
          error({ inflate = "stored block length check failed" }, 0)
        end
        pos = pos + 4
        if not bytes[pos + len - 1] and len > 0 then
          error({ inflate = "unexpected end of data" }, 0)
        end
        for i = 0, len - 1 do
          n = n + 1
          out[n] = bytes[pos + i]
        end
        pos = pos + len
      elseif btype == 1 or btype == 2 then
        local lit, dist = FIXED_LIT, FIXED_DIST
        if btype == 2 then
          local hlit, hdist, hclen = bits(5) + 257, bits(5) + 1, bits(4) + 4
          local cl = {}
          for i = 1, 19 do
            cl[i] = 0
          end
          for i = 1, hclen do
            cl[CL_ORDER[i] + 1] = bits(3)
          end
          local clt = huffman(cl)
          local lengths = {}
          while #lengths < hlit + hdist do
            local s = symbol(clt)
            if s < 16 then
              lengths[#lengths + 1] = s
            elseif s == 16 then
              local prev = lengths[#lengths]
              for _ = 1, 3 + bits(2) do
                lengths[#lengths + 1] = prev
              end
            else
              for _ = 1, (s == 17 and 3 + bits(3) or 11 + bits(7)) do
                lengths[#lengths + 1] = 0
              end
            end
          end
          local ll, dl = {}, {}
          for i = 1, hlit do
            ll[i] = lengths[i]
          end
          for i = 1, hdist do
            dl[i] = lengths[hlit + i]
          end
          lit, dist = huffman(ll), huffman(dl)
        end
        while true do
          local s = symbol(lit)
          if s < 256 then
            n = n + 1
            out[n] = s
          elseif s == 256 then
            break
          else
            local li = s - 256
            if not LEN_BASE[li] then
              error({ inflate = "bad length code" }, 0)
            end
            local length = LEN_BASE[li] + bits(LEN_EXTRA[li])
            local di = symbol(dist) + 1
            if not DIST_BASE[di] then
              error({ inflate = "bad distance code" }, 0)
            end
            local distance = DIST_BASE[di] + bits(DIST_EXTRA[di])
            if distance > n then
              error({ inflate = "back-reference before the start of the data" }, 0)
            end
            for _ = 1, length do
              n = n + 1
              out[n] = out[n - distance]
            end
          end
        end
      else
        error({ inflate = "invalid block type" }, 0)
      end
    until final == 1
  end)
  if not ok then
    return nil, type(err) == "table" and err.inflate or tostring(err)
  end
  -- adler32 of the output, big-endian, after the deflate data
  local a = bytes[pos + 3] and (((bytes[pos] * 256 + bytes[pos + 1]) * 256 + bytes[pos + 2]) * 256 + bytes[pos + 3])
  if a ~= adler32(out) then
    return nil, "checksum mismatch: the string is damaged or incomplete"
  end
  return out
end

local unpack_bytes = table.unpack -- Lua 5.2+ (Factorio and the CLI)

local function to_string(bytes)
  local parts = {}
  for i = 1, #bytes, 4096 do
    parts[#parts + 1] = string.char(unpack_bytes(bytes, i, math.min(i + 4095, #bytes)))
  end
  return table.concat(parts)
end

--- Does this text look like a blueprint string?
function codec.looks_like(text)
  return type(text) == "string" and text:match("^%s*0[%w+/=%s]+$") ~= nil
end

--- Blueprint string -> JSON text, or nil + message.
function codec.decode(text)
  local s = text:gsub("%s", "")
  if s:sub(1, 1) ~= "0" then
    return nil, "unknown blueprint string version " .. string.format("%q", s:sub(1, 1)) .. " (expected 0)"
  end
  local bytes, err = base64_decode(s:sub(2))
  if not bytes then
    return nil, err
  end
  local out
  out, err = inflate(bytes)
  if not out then
    return nil, err
  end
  return to_string(out)
end

--- JSON text -> blueprint string (zlib with stored blocks; the game reads it like any other).
function codec.encode(json_text)
  local data = {}
  for i = 1, #json_text, 4096 do
    for _, b in ipairs({ json_text:byte(i, math.min(i + 4095, #json_text)) }) do
      data[#data + 1] = b
    end
  end
  local z = { 0x78, 0x01 }
  local i = 1
  repeat
    local len = math.min(65535, #data - i + 1)
    local final = (i + len > #data) and 1 or 0
    z[#z + 1] = final
    z[#z + 1] = len % 256
    z[#z + 1] = floor(len / 256)
    z[#z + 1] = (65535 - len) % 256
    z[#z + 1] = floor((65535 - len) / 256)
    for k = i, i + len - 1 do
      z[#z + 1] = data[k]
    end
    i = i + len
  until i > #data
  local a = adler32(data)
  z[#z + 1] = floor(a / 16777216) % 256
  z[#z + 1] = floor(a / 65536) % 256
  z[#z + 1] = floor(a / 256) % 256
  z[#z + 1] = a % 256
  return "0" .. base64_encode(z)
end

codec._inflate, codec._base64_decode = inflate, base64_decode

return codec
