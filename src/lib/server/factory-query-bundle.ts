import { ServerError } from './server-files';

export function luaString(value: string) {
	let delimiter = '=';
	while (value.includes(`]${delimiter}]`)) delimiter += '=';
	return `[${delimiter}[${value}]${delimiter}]`;
}

// Sources use line comments only; multiline strings need Lua-aware compaction.
export function factoryBundle(sources: Record<string, string>, owners?: string[]) {
	const modules = Object.fromEntries(
		Object.entries(sources).map(([path, source]) => [
			path
				.replace('./factory-query/', '')
				.replace(/\.lua$/u, '')
				.replaceAll('/', '.'),
			source
				.split('\n')
				.filter((line) => line.trim() && !line.trimStart().startsWith('--'))
				.map((line) => line.trim())
				.join('\n')
		])
	);

	// Commands own their registry. No code is installed in the save, and only
	// reviewed local sources can supply modules or tools. Contracts identify owners;
	// static require dependencies keep each lookup's bundle small.
	const selected = new Set<string>();
	function include(name: string) {
		if (selected.has(name)) return;
		const source = modules[name];
		if (!source) throw new ServerError(400, 'Unknown query module');
		selected.add(name);
		for (const dependency of source.matchAll(/\brequire\s*\(\s*["']([^"']+)["']\s*\)/gu))
			if (dependency[1]) include(dependency[1]);
	}
	for (const owner of owners ?? Object.keys(modules)) include(owner);
	return `local native_remote = remote
local registry = {}
local remote = { interfaces = {} }
function remote.add_interface(name, functions) registry[name] = functions; remote.interfaces[name] = functions end
function remote.call(name, method, ...) return registry[name][method](...) end
local require
local modules = {
${[...selected].map((name) => `[ ${luaString(name)} ] = function()\n${modules[name]}\nend`).join(',\n')}
}
local loaded = {}
require = function(name)
 if not loaded[name] then loaded[name] = assert(modules[name], "Unknown query module")() end
 return loaded[name]
end
${
	owners
		? `local functions = {}
local manifest = {}
for _,name in ipairs({${owners.map(luaString).join(',')}}) do
 local module = require(name)
 if module.provider then module = module.provider(native_remote) end
 for tool,entry in pairs(module.manifest) do
  manifest[tool] = entry
  functions[tool] = assert(module.functions[tool], "Missing query implementation")
 end
end
functions.agent_tools_v1 = function() return {v=1,tools=manifest} end`
		: `require("scripts.tools.engine").register(native_remote)
local functions = registry["ai-agent-bridge-tools"]`
}
`;
}

export function factoryCommand(
	sources: Record<string, string>,
	request: Record<string, unknown>,
	owners?: string[]
) {
	const encoded = JSON.stringify(request);
	const routing = request.op === 'call' && request.tool === 'route_belt';
	if (Buffer.byteLength(encoded) > (routing ? 128000 : 8192))
		throw new ServerError(400, 'Query is too large');
	// Route geometry goes directly into a saved draft, rather than model context.
	const replyLimit = routing ? 131072 : 65536;
	return `/silent-command local ok, result = pcall(function()
${factoryBundle(sources, owners)}
local request = helpers.json_to_table(${luaString(encoded)})
if request.op == "catalog" then return functions.agent_tools_v1() end
local function lookup(query)
 if type(query.tool) ~= "string" or not functions.agent_tools_v1().tools[query.tool] then error("Unknown lookup",0) end
 if query.args ~= nil and type(query.args) ~= "table" then error("Arguments must be an object",0) end
 return functions[query.tool](query.args or {})
end
if request.op == "batch" then
 if type(request.queries)~="table" or #request.queries<1 or #request.queries>16 then error("A batch needs 1 to 16 read queries",0) end
 local results,fallbacks={},{}
 local used,reserved=0,0
 for index,query in ipairs(request.queries) do
  local fallback={tool=query.tool,ok=false,error="Result too large for this batch; narrow this query or use factory_lookup for it alone"}
  local size=#helpers.table_to_json(fallback)
  fallbacks[index]={row=fallback,size=size};reserved=reserved+size
 end
 for index,query in ipairs(request.queries) do
  local success,value=pcall(lookup,query)
  local row={tool=query.tool,ok=success}
  if success then row.result=value else row.error=tostring(value):match("^[^\\n]*") end
  local fallback=fallbacks[index]
  reserved=reserved-fallback.size
  local size=#helpers.table_to_json(row)
  -- Spend the shared reply budget, reserving a bounded outcome for every later query.
  if used+size+reserved>60000 then row=fallback.row;size=fallback.size end
  used=used+size;results[#results+1]=row
 end
 return {tick=game.tick,results=results}
end
if request.op ~= "call" then error("Unknown lookup operation",0) end
return lookup(request)
end)
local reply = helpers.table_to_json(ok and {ok=true, result=result} or {ok=false, error=tostring(result):match("^[^\\n]*")})
if #reply > ${replyLimit} then reply = '{"ok":false,"error":"Result too large; narrow the query"}' end
rcon.print(reply)`;
}
