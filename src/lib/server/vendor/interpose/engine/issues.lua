--- Problems the engine reports, in one shape for the CLI, the mod and the tests:
---   { code = "port-faces-out", message = "what is wrong", hint = "what the player can do about it" }
--- `code` is stable (tests and the mod's translations use it); message and hint are English text.
local issues = {}

function issues.new(code, message, hint)
  return { code = code, message = message, hint = hint }
end

--- Codes of a list of issues, in order (handy in tests).
function issues.codes(list)
  local out = {}
  for i, issue in ipairs(list or {}) do
    out[i] = issue.code
  end
  return out
end

--- One line of text: message, then the hint.
function issues.format(issue)
  if issue.hint then
    return issue.message .. " (" .. issue.hint .. ")"
  end
  return issue.message
end

return issues
