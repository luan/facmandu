import { z } from 'zod';
import type { ManagedServer } from './db/schema';
import { factoryCommand } from './factory-query-bundle';
import { factoryCatalog, factoryDefinesSchema } from './factory-query-catalog';
import { ServerError } from './server-files';
import { serverStatus } from './server-process';
import { rconScript } from './server-rcon';
import { prepareTaskList } from './task-list-bridge';

const sources = import.meta.glob<string>('./factory-query/scripts/**/*.lua', {
	query: '?raw',
	import: 'default',
	eager: true
});

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
	if (
		Array.isArray(queries) &&
		queries.some(
			(query: unknown) =>
				query !== null &&
				typeof query === 'object' &&
				'tool' in query &&
				(query.tool === 'task_list' || query.tool === 'mod_integrations')
		)
	)
		await prepareTaskList(server);
	return execute(server, request, selected);
}

async function execute(server: ManagedServer, request: Record<string, unknown>, owners?: string[]) {
	const raw = await rconScript(server, factoryCommand(sources, request, owners));
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
