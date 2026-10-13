import { z } from 'zod';
import type { ManagedServer } from './db/schema';
import { factoryBundle, luaString } from './factory-query-bundle';
import { factoryCatalog, factoryDefinesSchema } from './factory-query-catalog';
import { ServerError } from './server-files';
import { serverStatus } from './server-process';
import { rconScript } from './server-rcon';

const sources = import.meta.glob<string>('./factory-query/scripts/**/*.lua', {
	query: '?raw',
	import: 'default',
	eager: true
});

export function factoryCommand(request: Record<string, unknown>, owners?: string[]) {
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
// These contracts depend only on reviewed sources, not mutable world state or
// installed-mod availability. A new app release creates a fresh cache.
const manifests = new Map<
	string,
	Promise<{
		catalog: z.infer<ReturnType<typeof z.json>>;
		tools: z.infer<typeof catalogSchema>['tools'];
	}>
>();
const catalogSchema = z.object({
	v: z.number(),
	tools: z.record(z.string(), z.object({ module: z.string().optional() }).passthrough())
});

export async function factoryQuery(server: ManagedServer, request: Record<string, unknown>) {
	const status = await serverStatus(server);
	if (!status.running) throw new ServerError(409, 'Start this server to query the factory');
	const key = `${server.id}:${status.version.version}`;
	let manifest = manifests.get(key);
	if (!manifest) {
		manifest = (async () => {
			const raw = await rconScript(
				server,
				'/silent-command rcon.print(helpers.table_to_json({inventory=defines.inventory,flow_precision_index=defines.flow_precision_index,space_platform_state=defines.space_platform_state}))'
			);
			const defines = factoryDefinesSchema.parse(JSON.parse(raw));
			const catalog = factoryCatalog(sources, defines);
			return { catalog, tools: catalogSchema.parse(catalog).tools };
		})();
		manifests.set(key, manifest);
		manifest.catch(() => {
			if (manifests.get(key) === manifest) manifests.delete(key);
		});
	}
	const contract = await manifest;
	if (request.op === 'catalog') return contract.catalog;
	const queries = request.op === 'batch' ? request.queries : [request];
	const owners = Array.isArray(queries)
		? queries.map((query: unknown) => {
				if (
					!query ||
					typeof query !== 'object' ||
					!('tool' in query) ||
					typeof query.tool !== 'string'
				)
					return undefined;
				return contract.tools[query.tool]?.module;
			})
		: [];
	// Unknown or unattributed tools still go through full native validation.
	const selected =
		owners.length && owners.every((name): name is string => !!name)
			? [...new Set(owners)]
			: undefined;
	return execute(server, request, selected);
}

async function execute(server: ManagedServer, request: Record<string, unknown>, owners?: string[]) {
	const raw = await rconScript(server, factoryCommand(request, owners));
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
