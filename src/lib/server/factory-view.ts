import { z } from 'zod';
import {
	type FactoryViewRequest,
	factoryViewRequestSchema,
	factoryViewSchema
} from '#lib/factory-images.js';
import type { ManagedServer } from './db/schema';
import { FactoryImagePending, renderFactoryBlueprint } from './factory-images';
import source from './factory-view.lua?raw';
import { ServerError } from './server-files';
import { serverStatus } from './server-process';
import { rconScript } from './server-rcon';

export function factoryViewCommand(input: FactoryViewRequest, player?: string) {
	const encoded = JSON.stringify({ ...factoryViewRequestSchema.parse(input), player });
	let delimiter = '=';
	while (encoded.includes(`]${delimiter}]`)) delimiter += '=';
	return `/silent-command local request=helpers.json_to_table([${delimiter}[${encoded}]${delimiter}])
local inventory
local ok,result=pcall(function()
${source}
end)
if inventory and inventory.valid then inventory.destroy() end
local reply=helpers.table_to_json(ok and {ok=true,result=result} or {ok=false,error=tostring(result):match("^[^\\n]*")})
if #reply>200000 then reply='{"ok":false,"error":"Snapshot too large; select a smaller area"}' end
rcon.print(reply)`;
}
const replySchema = z.discriminatedUnion('ok', [
	z.object({
		ok: z.literal(true),
		result: factoryViewSchema.omit({ image: true }).extend({ blueprint: z.string().max(256000) })
	}),
	z.object({ ok: z.literal(false), error: z.string() })
]);
export async function captureFactoryView(server: ManagedServer, input: unknown, player?: string) {
	const parsed = factoryViewRequestSchema.safeParse(input);
	if (!parsed.success) throw new ServerError(400, 'Invalid factory view');
	if (!(await serverStatus(server)).running)
		throw new ServerError(409, 'Start this server to capture a current factory view');
	let decoded: unknown;
	try {
		decoded = JSON.parse(
			(await rconScript(server, factoryViewCommand(parsed.data, player))).trim()
		);
	} catch {
		throw new ServerError(502, 'The server did not return a factory view');
	}
	const reply = replySchema.safeParse(decoded);
	if (!reply.success) throw new ServerError(502, 'The server returned an invalid factory view');
	if (!reply.data.ok) throw new ServerError(409, reply.data.error);
	const { blueprint, ...snapshot } = reply.data.result;
	try {
		return { ...snapshot, blueprint, image: await renderFactoryBlueprint(server, blueprint, 2000) };
	} catch (cause) {
		if (!(cause instanceof FactoryImagePending)) throw cause;
		return {
			...snapshot,
			blueprint,
			kind: 'factory-preview-pending' as const,
			image: { id: cause.imageId },
			note: 'Preview is rendering. It will appear automatically when ready; continue with structured lookups instead of recapturing.'
		};
	}
}
