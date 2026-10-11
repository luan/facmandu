import { createHash } from 'node:crypto';
import { z } from 'zod';
import {
	type BlueprintRequest,
	blueprintDesignSchema,
	blueprintRequestSchema,
	blueprintTargetSchema
} from '$lib/blueprints';
import type { ManagedServer } from './db/schema';
import source from './factory-blueprints/blueprint.lua?raw';
import { ServerError } from './server-files';
import { serverStatus } from './server-process';
import { rconScript } from './server-rcon';

export const blueprintJsonSchema = z.toJSONSchema(blueprintRequestSchema);
export function blueprintDesignHash(input: unknown) {
	return createHash('sha256')
		.update(JSON.stringify(blueprintDesignSchema.parse(input)))
		.digest('hex');
}
export function blueprintCommand(
	input: BlueprintRequest,
	player?: { name: string; requireAdmin: boolean }
) {
	const design =
		input.operation === 'catalog'
			? undefined
			: input.operation === 'create'
				? blueprintDesignHash({
						force: input.force,
						label: input.label,
						entities: input.entities,
						tiles: input.tiles
					})
				: createHash('sha256')
						.update(
							JSON.stringify(
								blueprintTargetSchema.parse({
									force: input.force,
									label: input.label,
									entities: input.entities,
									tiles: input.tiles,
									surface: input.surface,
									position: input.position
								})
							)
						)
						.digest('hex');
	if (input.operation === 'place' && input.expectedDesign !== design)
		throw new ServerError(409, 'Blueprint changed; inspect placement again');
	const encoded = JSON.stringify({ ...input, design, player });
	if (Buffer.byteLength(encoded) > 48000) throw new ServerError(400, 'Blueprint is too large');
	let delimiter = '=';
	while (encoded.includes(`]${delimiter}]`)) delimiter += '=';
	return `/silent-command local request=helpers.json_to_table([${delimiter}[${encoded}]${delimiter}])
local inventory
local ok,result=pcall(function()
${source}
return blueprint(request)
end)
if inventory and inventory.valid then inventory.destroy() end
local reply=helpers.table_to_json(ok and {ok=true,result=result} or {ok=false,error=tostring(result):match("^[^\\n]*")})
if #reply>65536 then reply='{"ok":false,"error":"Blueprint result too large"}' end
rcon.print(reply)`;
}
const replySchema = z.discriminatedUnion('ok', [
	z.object({ ok: z.literal(true), result: z.json() }),
	z.object({ ok: z.literal(false), error: z.string() })
]);
export async function factoryBlueprint(
	server: ManagedServer,
	input: unknown,
	player?: { name: string; requireAdmin: boolean }
) {
	const parsed = blueprintRequestSchema.safeParse(input);
	if (!parsed.success) throw new ServerError(400, 'Invalid blueprint request');
	if (!(await serverStatus(server)).running)
		throw new ServerError(409, 'Start this server to design or place a blueprint');
	const raw = await rconScript(server, blueprintCommand(parsed.data, player));
	let decoded: unknown;
	try {
		decoded = JSON.parse(raw.trim());
	} catch {
		throw new ServerError(502, 'The server did not return a blueprint result');
	}
	const reply = replySchema.safeParse(decoded);
	if (!reply.success) throw new ServerError(502, 'The server returned an invalid blueprint result');
	if (!reply.data.ok) throw new ServerError(409, reply.data.error);
	return reply.data.result;
}
