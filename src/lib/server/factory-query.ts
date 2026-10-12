import { z } from 'zod';
import type { ManagedServer } from './db/schema';
import { ServerError } from './server-files';
import { serverStatus } from './server-process';
import { rconScript } from './server-rcon';

const sources = import.meta.glob<string>('./factory-query/scripts/**/*.lua', {
	query: '?raw',
	import: 'default',
	eager: true
});

function luaString(value: string) {
	let delimiter = '=';
	while (value.includes(`]${delimiter}]`)) delimiter += '=';
	return `[${delimiter}[${value}]${delimiter}]`;
}

// Each command owns its modules and registry. Nothing is installed in the save,
// and third-party remote interfaces cannot add callable tools. Documented planner
// reads use an explicit adapter; the native remote object is never caller-controlled.
// Sources use line comments only; multiline strings require Lua-aware compaction.
const bundle = `local native_remote = remote
local registry = {}
local remote = { interfaces = {} }
function remote.add_interface(name, functions) registry[name] = functions; remote.interfaces[name] = functions end
function remote.call(name, method, ...) return registry[name][method](...) end
local require
local modules = {
${Object.entries(sources)
	.map(
		([path, source]) =>
			`[ ${luaString(
				path
					.replace('./factory-query/', '')
					.replace(/\.lua$/u, '')
					.replaceAll('/', '.')
			)} ] = function()\n${source
				.split('\n')
				.filter((line) => line.trim() && !line.trimStart().startsWith('--'))
				.map((line) => line.trim())
				.join('\n')}\nend`
	)
	.join(',\n')}
}
local loaded = {}
require = function(name)
  if not loaded[name] then loaded[name] = assert(modules[name], "Unknown query module")() end
  return loaded[name]
end
require("scripts.tools.engine").register(native_remote)
local functions = registry["ai-agent-bridge-tools"]
`;

export function factoryCommand(request: Record<string, unknown>) {
	const encoded = JSON.stringify(request);
	if (Buffer.byteLength(encoded) > 8192) throw new ServerError(400, 'Query is too large');
	// Route geometry goes directly into a saved draft, rather than model context.
	const replyLimit = request.op === 'call' && request.tool === 'route_belt' ? 131072 : 65536;
	return `/silent-command local ok, result = pcall(function()
${bundle}
local request = helpers.json_to_table(${luaString(encoded)})
if request.op == "catalog" then return functions.agent_tools_v1() end
local function lookup(query)
 if type(query.tool) ~= "string" or not functions.agent_tools_v1().tools[query.tool] then error("Unknown lookup",0) end
 if query.args ~= nil and type(query.args) ~= "table" then error("Arguments must be an object",0) end
 return functions[query.tool](query.args or {})
end
if request.op == "batch" then
 if type(request.queries)~="table" or #request.queries<1 or #request.queries>16 then error("A batch needs 1 to 16 read queries",0) end
 local results={}
 for _,query in ipairs(request.queries) do
  local success,value=pcall(lookup,query)
  local row={tool=query.tool,ok=success}
  if success then row.result=value else row.error=tostring(value):match("^[^\\n]*") end
  if #helpers.table_to_json(row)>math.floor(60000/#request.queries) then
   row={tool=query.tool,ok=false,error="Result too large for this batch; narrow this query or use factory_lookup for it alone"}
  end
  results[#results+1]=row
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

const replySchema = z.discriminatedUnion('ok', [
	z.object({ ok: z.literal(true), result: z.json() }),
	z.object({ ok: z.literal(false), error: z.string() })
]);
export async function factoryQuery(server: ManagedServer, request: Record<string, unknown>) {
	if (!(await serverStatus(server)).running)
		throw new ServerError(409, 'Start this server to query the factory');
	const raw = await rconScript(server, factoryCommand(request));
	const parsed = replySchema.safeParse(
		(() => {
			try {
				return JSON.parse(raw.trim());
			} catch {
				return null;
			}
		})()
	);
	if (!parsed.success) throw new ServerError(502, 'The server did not return a valid query result');
	if (!parsed.data.ok) throw new ServerError(400, parsed.data.error);
	return parsed.data.result;
}
