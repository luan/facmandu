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
const entity = logistic.pick({ unitNumber: true, force: true, surface: true, position: true });
const wireEndpoint = entity.pick({ unitNumber: true, position: true }).extend({
	name,
	connectorId: index
});
const wire = z.object({ force: label, surface: label, source: wireEndpoint, target: wireEndpoint });
const direction = z.union([z.literal(0), z.literal(4), z.literal(8), z.literal(12)]);
const taskFields = z.object({
	title: z.string().min(1).max(200),
	description: z.string().max(2000),
	status: z.enum(['not_started', 'in_progress', 'paused', 'blocked']),
	completed: z.boolean()
});

const editSnapshot = z.object({
	unitNumber: entity.shape.unitNumber,
	name,
	position: entity.shape.position,
	direction: z.number().int().min(0).max(15),
	ghost: z.boolean(),
	recipe: z.string(),
	deconstructing: z.boolean()
});
const editTargets = z
	.array(editSnapshot.pick({ unitNumber: true, name: true, position: true }))
	.min(1)
	.max(16);
const edits = z
	.array(
		z.discriminatedUnion('kind', [
			editSnapshot.extend({ kind: z.literal('rotate'), to: direction }),
			editSnapshot.extend({ kind: z.literal('deconstruct') }),
			editSnapshot.extend({ kind: z.literal('cancel_deconstruction') }),
			editSnapshot.extend({ kind: z.literal('cancel_ghost') })
		])
	)
	.min(1)
	.max(16)
	.refine(
		(targets) => new Set(targets.map((target) => target.unitNumber)).size === targets.length,
		'An entity may appear only once'
	);
export const factoryActionInspectSchema = z.discriminatedUnion('operation', [
	wire.extend({ operation: z.literal('wire_inspect') }),
	z.object({
		operation: z.literal('entities_inspect'),
		force: label,
		surface: label,
		targets: editTargets
	}),
	entity.extend({ operation: z.literal('entity_inspect') }),
	entity.extend({ operation: z.literal('ghost_inspect') }),
	z.object({ operation: z.literal('research_inspect'), force: label }),
	z.object({
		operation: z.literal('train_inspect'),
		trainId: train.shape.trainId,
		force: label.optional()
	}),
	z.object({
		operation: z.literal('logistic_inspect'),
		force: label.optional(),
		unitNumber: logistic.shape.unitNumber,
		surface: label,
		position: logistic.shape.position,
		sectionIndex: index,
		slotIndex: index
	})
]);

export const factoryActionSchema = z.discriminatedUnion('operation', [
	wire.extend({
		operation: z.literal('wire_connect'),
		expectedTick: z.number().int().nonnegative(),
		expectedConnected: z.boolean(),
		expectedSourceGhost: z.boolean(),
		expectedTargetGhost: z.boolean()
	}),
	z.object({
		operation: z.literal('drone_command'),
		force: label,
		owner: label,
		command: z.enum(['follow', 'stay', 'move']),
		expected: z.object({
			unitNumber: entity.shape.unitNumber,
			revision: z.number().int().nonnegative(),
			surface: label
		}),
		position: entity.shape.position.optional()
	}),
	taskFields.omit({ completed: true }).extend({ operation: z.literal('task_add'), force: label }),
	taskFields.extend({
		operation: z.literal('task_update'),
		force: label,
		id: z.number().int().positive(),
		expected: taskFields
	}),
	z.object({
		operation: z.literal('entities_edit'),
		force: label,
		surface: label,
		expectedTick: z.number().int().nonnegative(),
		edits
	}),
	entity.extend({
		operation: z.literal('entity_rotate'),
		expectedDirection: direction,
		expectedTick: z.number().int().nonnegative(),
		direction
	}),
	entity.extend({
		operation: z.literal('ghost_cancel'),
		expectedDirection: direction,
		expectedTick: z.number().int().nonnegative()
	}),
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
export const factoryActionJsonSchema = z.toJSONSchema(factoryActionSchema, { io: 'input' });
export const factoryActionInspectJsonSchema = z.toJSONSchema(factoryActionInspectSchema, {
	io: 'input'
});

export const factoryActionInspectManifest = {
	wire_inspect:
		'Inspect an exact pair of same-force stationary entities or ghosts and native wire connector IDs. Returns connection state, ghost identities and tick for wire_connect. Does not create connectors or change wiring.',
	entities_inspect:
		'Inspect up to 16 exact built entities or construction ghosts by unitNumber, prototype name and position. Returns tick and snapshots for entities_edit.',
	entity_inspect:
		'Inspect one stationary player-built factory entity by unitNumber, force, surface and exact position. Returns direction and tick for rotation preconditions, plus pickup/drop positions for inserters.',
	ghost_inspect:
		'Inspect one construction ghost by unitNumber, force, surface and exact position before cancelling it.',
	research_inspect:
		'Read the entire ordered queue for a force before changing it. Returns queue names for expectedQueue.',
	train_inspect: 'Read an exact train by trainId before changing its control or destination.',
	logistic_inspect:
		'Read an exact requester by unitNumber, surface, position, sectionIndex, slotIndex before changing a request.'
} satisfies Record<FactoryActionInspect['operation'], string>;

export const factoryActionManifest = {
	wire_connect:
		'Connect an inspected native copper or circuit wire between two same-force stationary entities or construction ghosts, including existing-world endpoints omitted from a blueprint. Supply source/target identities and connectorId, force/surface, and expectedTick/Connected/SourceGhost/TargetGhost from wire_inspect. Native reach and wire compatibility are enforced. Never disconnects other wires, replaces entities, supplies items or changes research.',
	drone_command:
		'Control the owning player’s automatic Toby companion. Supply force, owner, command (follow, stay, move), and expected unitNumber/revision/surface from a fresh toby_drone lookup; move also needs position within 256 explored tiles. Toby follows and constructs nearby ghosts using actual materials from its cargo, the player or nearby same-force provider/storage chests. No crafting, equipment, robots or fuel is needed. Missing materials leave ghosts untouched; no building items or research are granted. In-game callers can command only their own drone.',
	task_add:
		'Add a shared force task to Task List using title, description and status (not_started, in_progress, paused, blocked). Identical active tasks are reused. Changes use the native mod and refresh its normal GUI; no world construction is implied.',
	task_update:
		'Update a shared force task using id, title, description, status and completed. Copy expected title, description, status and completed from a fresh task_list read; concurrent edits are rejected. Private player tasks are inaccessible.',
	entities_edit:
		'Edit up to 16 exact freshly inspected targets: rotate with native game rotation, mark built entities for normal robot deconstruction, cancel deconstruction, or cancel construction ghosts. Supply force, surface, expectedTick and edits copied from entities_inspect snapshots plus kind (and to for rotate). Rechecks every target before any write. Deconstruction queues robot work and retains normal material recovery; it never destroys a built entity or grants items. Return outcomes are per-target; verify completion before reconnecting a replacement.',
	entity_rotate:
		'Rotate one stationary player-built factory entity to cardinal direction 0, 4, 8 or 12 using native rotation. Supply exact entity_inspect target, expectedDirection and expectedTick. Inspect again afterward to verify orientation and inserter pickup/drop. Native rotation enforces game constraints; cannot rotate ghosts or vehicles.',
	ghost_cancel:
		'Cancel one exact inspected construction ghost using expectedDirection and expectedTick. Never removes a built entity.',
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
const entitySnapshot = entity.extend({
	name,
	direction,
	tick: z.number().int().nonnegative(),
	pickup: logistic.shape.position.optional(),
	drop: logistic.shape.position.optional()
});
const entityResultSchema = z.object({
	operation: z.enum(['entity_inspect', 'entity_rotate']),
	before: entitySnapshot,
	after: entitySnapshot
});
const ghostSnapshot = entitySnapshot.omit({ pickup: true, drop: true });
const ghostResultSchema = z.discriminatedUnion('operation', [
	z.object({ operation: z.literal('ghost_inspect'), before: ghostSnapshot, after: ghostSnapshot }),
	z.object({
		operation: z.literal('ghost_cancel'),
		before: ghostSnapshot,
		after: z.object({ cancelled: z.literal(true) })
	})
]);
const wireResultSchema = z.object({
	operation: z.enum(['wire_inspect', 'wire_connect']),
	tick: z.number().int().nonnegative(),
	sourceGhost: z.boolean(),
	targetGhost: z.boolean(),
	connected: z.boolean(),
	canReach: z.boolean().optional()
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
	if (input.operation.startsWith('wire_')) {
		const result = wireResultSchema.safeParse(reply.data.result);
		if (!result.success) throw new ServerError(502, 'The server returned an invalid wire result');
		return result.data;
	}
	if (input.operation === 'drone_command') {
		const result = z
			.object({
				operation: z.literal('drone_command'),
				drone: z.object({
					available: z.literal(true),
					player: label,
					force: label,
					unitNumber: entity.shape.unitNumber,
					surface: label,
					position: entity.shape.position,
					mode: z.enum(['follow', 'stay', 'move']),
					revision: z.number().int().nonnegative(),
					built: z.number().int().nonnegative(),
					working: label.optional(),
					cargo: z
						.union([
							z
								.array(
									z.object({ name: label, quality: label, count: z.number().int().positive() })
								)
								.max(20),
							z.object({}).strict()
						])
						.transform((items) => (Array.isArray(items) ? items : [])),
					destination: entity.shape.position.optional()
				})
			})
			.safeParse(reply.data.result);
		if (!result.success)
			throw new ServerError(502, 'The server returned an invalid Toby drone result');
		return result.data;
	}
	if (input.operation.startsWith('task_')) {
		const result = z
			.object({
				operation: z.enum(['task_add', 'task_update']),
				task: taskFields.extend({
					id: z.number().int().positive(),
					assignee: z.string().optional()
				}),
				created: z.boolean().optional()
			})
			.safeParse(reply.data.result);
		if (!result.success) throw new ServerError(502, 'The server returned an invalid task result');
		return result.data;
	}
	if (input.operation === 'entities_inspect' || input.operation === 'entities_edit') {
		const result = z
			.object({
				operation: z.enum(['entities_inspect', 'entities_edit']),
				tick: z.number().int(),
				entities: z.array(editSnapshot).optional(),
				outcomes: z
					.array(
						z.object({
							name,
							unitNumber: entity.shape.unitNumber,
							state: z.enum(['rotated', 'marked', 'cancelled', 'refused']),
							error: z.string().optional()
						})
					)
					.optional()
			})
			.safeParse(reply.data.result);
		if (!result.success)
			throw new ServerError(502, 'The server returned an invalid entity edit result');
		return result.data;
	}
	if (input.operation.startsWith('ghost_')) {
		const result = ghostResultSchema.safeParse(reply.data.result);
		if (!result.success) throw new ServerError(502, 'The server returned an invalid ghost result');
		return result.data;
	}
	if (input.operation.startsWith('entity_')) {
		const result = entityResultSchema.safeParse(reply.data.result);
		if (!result.success) throw new ServerError(502, 'The server returned an invalid entity result');
		return result.data;
	}
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

export function factoryActionInspect(
	server: ManagedServer,
	input: unknown,
	player?: GameActionPlayer
) {
	const parsed = factoryActionInspectSchema.safeParse(input);
	if (!parsed.success) throw new ServerError(400, 'Invalid factory inspection');
	return execute(server, parsed.data, player);
}
