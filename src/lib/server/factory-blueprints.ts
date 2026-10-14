import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import {
	type BlueprintRequest,
	blueprintDesignSchema,
	blueprintProgramSchema,
	blueprintReferenceSchema,
	blueprintRequestSchema,
	blueprintRowsSchema,
	blueprintTargetSchema,
	combineBlueprintDesigns,
	expandBlueprintRows,
	reviseBlueprintDesign
} from '$lib/blueprints';
import { runBlueprintProgram } from './blueprint-program';
import type { ManagedServer } from './db/schema';
import source from './factory-blueprints/blueprint.lua?raw';
import territorySource from './factory-query/scripts/tools/territory.lua?raw';
import { ServerError } from './server-files';
import { serverStatus } from './server-process';
import { rconScript } from './server-rcon';

// The operation belongs outside args. Reusing request schemas verbatim made the
// model emit a second operation inside args and obscured which fields go together.
const variants = [
	...blueprintRequestSchema.options,
	...blueprintReferenceSchema.options,
	blueprintRowsSchema,
	blueprintProgramSchema
].map((variant) => {
	const { operation, ...fields } = variant.shape;
	return z.strictObject({
		operation,
		display: z.boolean().optional(),
		args: z.strictObject(fields)
	});
});
// Generate the union once so repeated entity/settings schemas share references.
const contract = z.toJSONSchema(z.union(variants), { io: 'input', reused: 'ref' });
export const blueprintToolJsonSchema = {
	type: 'object',
	properties: {
		operation: {
			type: 'string',
			enum: ['catalog', 'create', 'program', 'inspect', 'place', 'check']
		},
		display: { type: 'boolean' },
		args: { type: 'object' }
	},
	required: ['operation', 'args'],
	additionalProperties: false,
	oneOf: contract.anyOf,
	$defs: contract.$defs
};
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
						wires: input.wires,
						tiles: input.tiles
					})
				: createHash('sha256')
						.update(
							JSON.stringify(
								blueprintTargetSchema.parse({
									force: input.force,
									label: input.label,
									entities: input.entities,
									wires: input.wires,
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
	if (Buffer.byteLength(encoded) > 128000) throw new ServerError(400, 'Blueprint is too large');
	let delimiter = '=';
	while (encoded.includes(`]${delimiter}]`)) delimiter += '=';
	return `/silent-command local request=helpers.json_to_table([${delimiter}[${encoded}]${delimiter}])
local inventory
local ok,result=pcall(function()
${source}
return blueprint(request,(function()
${territorySource}
end)())
end)
if inventory and inventory.valid then inventory.destroy() end
local reply=helpers.table_to_json(ok and {ok=true,result=result} or {ok=false,error=tostring(result):match("^[^\\n]*")})
if #reply>196608 then reply='{"ok":false,"error":"Blueprint result too large"}' end
rcon.print(reply)`;
}
const replySchema = z.discriminatedUnion('ok', [
	z.object({ ok: z.literal(true), result: z.json() }),
	z.object({ ok: z.literal(false), error: z.string() })
]);
export async function readBlueprintDraft(directory: string, id: string, force: string) {
	let saved: z.infer<typeof blueprintDesignSchema>;
	try {
		saved = blueprintDesignSchema.parse(
			JSON.parse(await readFile(join(directory, 'blueprint-drafts', `${id}.json`), 'utf8'))
		);
	} catch {
		throw new ServerError(404, 'Blueprint draft not found on this server; create it again');
	}
	if (blueprintDesignHash(saved) !== id || saved.force !== force)
		throw new ServerError(409, 'Blueprint draft does not match this force or its recorded design');
	return saved;
}
export async function factoryBlueprint(
	server: ManagedServer,
	input: unknown,
	player?: { name: string; requireAdmin: boolean }
) {
	let revisionOf: string | undefined;
	if (
		typeof input === 'object' &&
		input !== null &&
		'operation' in input &&
		input.operation === 'program'
	) {
		const request = blueprintProgramSchema.parse(input);
		const base = request.designId
			? await readBlueprintDraft(server.directory, request.designId, request.force)
			: blueprintDesignSchema.parse({ force: request.force, label: request.label });
		const design = await runBlueprintProgram(request.program, { ...base, label: request.label });
		revisionOf = request.designId;
		input = { ...design, operation: 'create' };
	}
	const schema =
		typeof input === 'object' && input !== null && !Array.isArray(input)
			? 'designId' in input
				? blueprintReferenceSchema
				: 'entityRows' in input
					? blueprintRowsSchema
					: blueprintRequestSchema
			: blueprintRequestSchema;
	const parsed = schema.safeParse(input);
	if (!parsed.success)
		throw new ServerError(
			400,
			`Invalid blueprint request: ${parsed.error.issues
				.slice(0, 3)
				.map((issue) => `${issue.path.join('.') || 'args'}: ${issue.message}`)
				.join('; ')}`
		);
	let resolved: BlueprintRequest;
	if ('designId' in parsed.data) {
		const reference = parsed.data;
		const saved = await readBlueprintDraft(server.directory, reference.designId, reference.force);
		if (reference.operation === 'create') {
			revisionOf = reference.designId;
			const parts = await Promise.all(
				reference.parts.map(async (part) => ({
					design: await readBlueprintDraft(server.directory, part.designId, reference.force),
					offset: part.offset
				}))
			);
			try {
				resolved = reviseBlueprintDesign(combineBlueprintDesigns(saved, parts), reference);
			} catch (cause) {
				throw new ServerError(400, cause instanceof Error ? cause.message : 'Invalid revision');
			}
		} else {
			const { designId: _id, ...target } = reference;
			resolved = blueprintRequestSchema.parse({ ...saved, ...target });
		}
	} else
		resolved =
			'entityRows' in parsed.data
				? expandBlueprintRows(blueprintRowsSchema.parse(parsed.data))
				: parsed.data;
	if (!(await serverStatus(server)).running)
		throw new ServerError(409, 'Start this server to design or place a blueprint');
	const command = blueprintCommand(resolved, player);
	let designId: string | undefined;
	if (resolved.operation === 'create') {
		const { operation: _operation, ...design } = resolved;
		designId = blueprintDesignHash(design);
		const directory = join(server.directory, 'blueprint-drafts');
		await mkdir(directory, { recursive: true, mode: 0o700 });
		try {
			await writeFile(join(directory, `${designId}.json`), JSON.stringify(design), {
				flag: 'wx',
				mode: 0o600
			});
		} catch (cause) {
			if ((cause as NodeJS.ErrnoException).code !== 'EEXIST') throw cause;
		}
	}
	const raw = await rconScript(server, command);
	let decoded: unknown;
	try {
		decoded = JSON.parse(raw.trim());
	} catch {
		throw new ServerError(502, 'The server did not return a blueprint result');
	}
	const reply = replySchema.safeParse(decoded);
	if (!reply.success) throw new ServerError(502, 'The server returned an invalid blueprint result');
	if (!reply.data.ok)
		throw new ServerError(
			409,
			`${reply.data.error}${designId ? ` Unvalidated draft saved: designId=${designId}. Revise it with create, designId and entityChanges or removedEntityIndices; do not retransmit the layout. No export or placement succeeded.` : ''}`
		);
	if (resolved.operation === 'create') {
		const artifact = z
			.object({ kind: z.literal('blueprint') })
			.passthrough()
			.parse(reply.data.result);
		return {
			...artifact,
			designId,
			...(revisionOf && revisionOf !== designId ? { revisionOf } : {})
		};
	}
	return reply.data.result;
}
