import { z } from 'zod';
import type { ManagedServer } from './db/schema';
import source from './factory-actions/action.lua?raw';
import { ServerError } from './server-files';
import { serverStatus } from './server-process';
import { rconScript } from './server-rcon';

const name = z.string().min(1).max(200);
const label = name;
const index = z.number().int().min(1).max(65535);
const queue = z.array(name).max(200);
const research = z.object({ force: label, expectedQueue: queue });
const train = z.object({
	trainId: z.number().int().min(1).max(4294967295),
	force: label,
	surface: label,
	expectedManual: z.boolean(),
	expectedGroup: z.string().max(200),
	expectedCurrentIndex: z.number().int().min(0).max(65535),
	expectedScheduleTick: z.number().int().nonnegative(),
	expectedStations: z.array(z.string().max(200)).max(100)
});
const request = z.object({
	item: name,
	quality: name,
	count: z.number().int().min(0).max(2147483647)
});
const waitCondition = z.discriminatedUnion('kind', [
	z.object({ kind: z.literal('time'), ticks: z.number().int().min(60).max(216000) }),
	z.object({ kind: z.literal('inactivity'), ticks: z.number().int().min(60).max(216000) }),
	z.object({ kind: z.literal('full') }),
	z.object({ kind: z.literal('empty') })
]);
const logistic = z.object({
	unitNumber: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
	force: label,
	surface: label,
	position: z.object({ x: z.number().finite(), y: z.number().finite() }),
	sectionIndex: index,
	slotIndex: index,
	expectedRequest: request.nullable()
});

export const factoryActionInspectSchema = z.discriminatedUnion('operation', [
	z.object({ operation: z.literal('research_inspect'), force: label }),
	z.object({ operation: z.literal('train_inspect'), trainId: train.shape.trainId }),
	z.object({
		operation: z.literal('logistic_inspect'),
		unitNumber: logistic.shape.unitNumber,
		surface: label,
		position: logistic.shape.position,
		sectionIndex: index,
		slotIndex: index
	})
]);

export const factoryActionSchema = z.discriminatedUnion('operation', [
	research.extend({ operation: z.literal('research_add'), technology: name }),
	research.extend({ operation: z.literal('research_move'), from: index, to: index }),
	research.extend({ operation: z.literal('research_remove'), position: index }),
	research.extend({ operation: z.literal('research_cancel') }),
	train.extend({ operation: z.literal('train_manual'), manual: z.boolean() }),
	train.extend({ operation: z.literal('train_go_to'), stationIndex: index }),
	train.extend({
		operation: z.literal('train_add_stop'),
		station: z.string().min(1).max(200),
		wait: waitCondition
	}),
	train.extend({
		operation: z.literal('train_update_stop'),
		stationIndex: index,
		station: z.string().min(1).max(200)
	}),
	train.extend({ operation: z.literal('train_remove_stop'), stationIndex: index }),
	logistic.extend({
		operation: z.literal('logistic_set_request'),
		item: name,
		quality: name,
		count: z.number().int().positive().max(2147483647)
	}),
	logistic.extend({ operation: z.literal('logistic_clear_request') })
]);

export type FactoryAction = z.infer<typeof factoryActionSchema>;
export type FactoryActionInspect = z.infer<typeof factoryActionInspectSchema>;
export const factoryActionJsonSchema = z.toJSONSchema(factoryActionSchema);
export const factoryActionInspectJsonSchema = z.toJSONSchema(factoryActionInspectSchema);

export const factoryActionInspectManifest = {
	research_inspect:
		'Read the entire ordered queue for a force before changing it. Returns queue names for expectedQueue.',
	train_inspect: 'Read an exact train by trainId before changing its control or destination.',
	logistic_inspect:
		'Read an exact requester by unitNumber, surface, position, sectionIndex, slotIndex before changing a request.'
} satisfies Record<FactoryActionInspect['operation'], string>;

export const factoryActionManifest = {
	research_add:
		'Queue one researchable lab technology. Supply force, expectedQueue, technology. Crafting trigger technologies cannot be queued.',
	research_move:
		'Move one queued research entry. Supply force, expectedQueue, from, to. The active first entry cannot move.',
	research_remove:
		'Remove one queued research entry. Supply force, expectedQueue, position. The active first entry cannot be removed here.',
	research_cancel:
		'Cancel current research. Factorio also removes dependent queued technologies. Supply force and expectedQueue.',
	train_manual:
		'Set manual or automatic control on an exact train. Supply trainId, force, surface, expectedManual, expectedGroup, expectedCurrentIndex, expectedScheduleTick, expectedStations, manual.',
	train_go_to:
		'Send an exact train to an existing schedule stop. Supply trainId, force, surface, expectedManual, expectedGroup, expectedCurrentIndex, expectedScheduleTick, expectedStations, stationIndex.',
	train_add_stop:
		'Append one station with one bounded wait condition (time, inactivity, full or empty). Supply exact inspected train snapshot plus station and wait.',
	train_update_stop:
		'Rename one train schedule stop while retaining its wait conditions and all other schedule fields. Supply exact inspected train snapshot, stationIndex, station.',
	train_remove_stop:
		'Remove one train schedule stop by index. Supply exact inspected train snapshot and stationIndex.',
	logistic_set_request:
		'Set an exact requester entity section slot to an item count. Supply unitNumber, force, surface, position, sectionIndex, slotIndex, expectedRequest, item, quality, count. Use the same item and quality when editing an occupied slot.',
	logistic_clear_request:
		'Clear an exact requester entity section slot. Supply unitNumber, force, surface, position, sectionIndex, slotIndex, expectedRequest.'
} satisfies Record<FactoryAction['operation'], string>;

function luaString(value: string) {
	let delimiter = '=';
	while (value.includes(`]${delimiter}]`)) delimiter += '=';
	return `[${delimiter}[${value}]${delimiter}]`;
}

type GameActionPlayer = { name: string; requireAdmin: boolean };

export function factoryActionCommand(
	input: FactoryAction | FactoryActionInspect,
	player?: GameActionPlayer
) {
	const encoded = JSON.stringify({ ...input, player });
	if (Buffer.byteLength(encoded) > 8192) throw new ServerError(400, 'Action is too large');
	return `/silent-command local request = helpers.json_to_table(${luaString(encoded)})
local ok, result = pcall(function()
if request.player then
 local p = game.get_player(request.player.name)
 if not p or not p.connected or p.force.name ~= request.force or (request.player.requireAdmin and not p.admin) then error("Player permission changed; ask again", 0) end
end
${source}
return action(request)
end)
local reply = helpers.table_to_json(ok and {ok=true,result=result} or {ok=false,error=tostring(result):match("^[^\\n]*")})
if #reply > 65536 then reply = '{"ok":false,"error":"Action result too large"}' end
rcon.print(reply)`;
}

const replySchema = z.discriminatedUnion('ok', [
	z.object({ ok: z.literal(true), result: z.json() }),
	z.object({ ok: z.literal(false), error: z.string() })
]);
const researchResultSchema = z.object({
	operation: z.enum([
		'research_inspect',
		'research_add',
		'research_move',
		'research_remove',
		'research_cancel'
	]),
	before: z.object({ queue: z.union([z.array(name), z.object({}).strict()]) }).passthrough(),
	after: z.object({ queue: z.union([z.array(name), z.object({}).strict()]) }).passthrough()
});
const trainResultSchema = z.object({
	operation: z.enum([
		'train_inspect',
		'train_manual',
		'train_go_to',
		'train_add_stop',
		'train_update_stop',
		'train_remove_stop'
	]),
	before: z
		.object({ stations: z.union([z.array(z.string()), z.object({}).strict()]) })
		.passthrough(),
	after: z.object({ stations: z.union([z.array(z.string()), z.object({}).strict()]) }).passthrough()
});
const logisticResultSchema = z.object({
	operation: z.enum(['logistic_inspect', 'logistic_set_request', 'logistic_clear_request']),
	before: z.object({ request: request.optional() }).passthrough(),
	after: z.object({ request: request.optional() }).passthrough()
});

async function execute(
	server: ManagedServer,
	input: FactoryAction | FactoryActionInspect,
	player?: GameActionPlayer
) {
	if (!(await serverStatus(server)).running)
		throw new ServerError(409, 'Start this server to access the factory');
	const raw = await rconScript(server, factoryActionCommand(input, player));
	let decoded: unknown;
	try {
		decoded = JSON.parse(raw.trim());
	} catch {
		throw new ServerError(502, 'The server did not return a valid action result');
	}
	const reply = replySchema.safeParse(decoded);
	if (!reply.success) throw new ServerError(502, 'The server did not return a valid action result');
	if (!reply.data.ok) throw new ServerError(409, reply.data.error);
	if (input.operation.startsWith('research_')) {
		const result = researchResultSchema.safeParse(reply.data.result);
		if (!result.success)
			throw new ServerError(502, 'The server returned an invalid research result');
		return {
			...result.data,
			before: {
				...result.data.before,
				queue: Array.isArray(result.data.before.queue) ? result.data.before.queue : []
			},
			after: {
				...result.data.after,
				queue: Array.isArray(result.data.after.queue) ? result.data.after.queue : []
			}
		};
	}
	if (input.operation.startsWith('train_')) {
		const result = trainResultSchema.safeParse(reply.data.result);
		if (!result.success) throw new ServerError(502, 'The server returned an invalid train result');
		return {
			...result.data,
			before: {
				...result.data.before,
				stations: Array.isArray(result.data.before.stations) ? result.data.before.stations : []
			},
			after: {
				...result.data.after,
				stations: Array.isArray(result.data.after.stations) ? result.data.after.stations : []
			}
		};
	}
	const result = logisticResultSchema.safeParse(reply.data.result);
	if (!result.success) throw new ServerError(502, 'The server returned an invalid logistic result');
	return {
		...result.data,
		before: { ...result.data.before, request: result.data.before.request ?? null },
		after: { ...result.data.after, request: result.data.after.request ?? null }
	};
}

export function factoryAction(server: ManagedServer, input: unknown, player?: GameActionPlayer) {
	const parsed = factoryActionSchema.safeParse(input);
	if (!parsed.success) throw new ServerError(400, 'Invalid factory action');
	return execute(server, parsed.data, player);
}

export function factoryActionInspect(server: ManagedServer, input: unknown) {
	const parsed = factoryActionInspectSchema.safeParse(input);
	if (!parsed.success) throw new ServerError(400, 'Invalid factory inspection');
	return execute(server, parsed.data);
}
