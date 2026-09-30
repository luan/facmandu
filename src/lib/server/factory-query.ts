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
// and third-party remote interfaces cannot add callable tools.
const bundle = `local registry = {}
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
			)} ] = function()\n${source}\nend`
	)
	.join(',\n')}
}
local loaded = {}
require = function(name)
  if not loaded[name] then loaded[name] = assert(modules[name], "Unknown query module")() end
  return loaded[name]
end
require("scripts.tools.engine").register()
local functions = registry["ai-agent-bridge-tools"]
`;

export function factoryCommand(request: Record<string, unknown>) {
	const encoded = JSON.stringify(request);
	if (Buffer.byteLength(encoded) > 8192) throw new ServerError(400, 'Query is too large');
	return `/silent-command local ok, result = pcall(function()
${bundle}
local request = helpers.json_to_table(${luaString(encoded)})
if request.op == "catalog" then return functions.agent_tools_v1() end
if request.op ~= "call" or type(request.tool) ~= "string" or not functions.agent_tools_v1().tools[request.tool] then error("Unknown lookup", 0) end
if request.args ~= nil and type(request.args) ~= "table" then error("Arguments must be an object", 0) end
return functions[request.tool](request.args or {})
end)
local reply = helpers.table_to_json(ok and {ok=true, result=result} or {ok=false, error=tostring(result):match("^[^\\n]*")})
if #reply > 65536 then reply = '{"ok":false,"error":"Result too large; narrow the query"}' end
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
