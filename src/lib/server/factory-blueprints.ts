import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import {
	type BlueprintRequest,
	blueprintDesignSchema,
	blueprintReferenceSchema,
	blueprintRequestSchema,
	blueprintRowsSchema,
	blueprintTargetSchema,
	expandBlueprintRows,
	reviseBlueprintDesign
} from '$lib/blueprints';
import type { ManagedServer } from './db/schema';
import source from './factory-blueprints/blueprint.lua?raw';
import { ServerError } from './server-files';
import { serverStatus } from './server-process';
import { rconScript } from './server-rcon';

// The operation belongs outside args. Reusing request schemas verbatim made the
// model emit a second operation inside args and obscured which fields go together.
export const blueprintToolJsonSchema = {
	type: 'object',
	properties: {
		operation: { type: 'string', enum: ['catalog', 'create', 'inspect', 'place', 'check'] },
		display: { type: 'boolean' },
		args: { type: 'object' }
	},
	required: ['operation', 'args'],
	additionalProperties: false,
	oneOf: [
		...blueprintRequestSchema.options,
		...blueprintReferenceSchema.options,
		blueprintRowsSchema
	].map((variant) => {
		const { operation, ...fields } = variant.shape;
		return z.toJSONSchema(
			z.strictObject({ operation, display: z.boolean().optional(), args: z.strictObject(fields) }),
			{ io: 'input' }
		);
	})
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
		let saved: z.infer<typeof blueprintDesignSchema>;
		try {
			saved = blueprintDesignSchema.parse(
				JSON.parse(
					await readFile(
						join(server.directory, 'blueprint-drafts', `${reference.designId}.json`),
						'utf8'
					)
				)
			);
		} catch {
			throw new ServerError(404, 'Blueprint draft not found on this server; create it again');
		}
		if (blueprintDesignHash(saved) !== reference.designId || saved.force !== reference.force)
			throw new ServerError(
				409,
				'Blueprint draft does not match this force or its recorded design'
			);
		if (reference.operation === 'create') {
			try {
				resolved = reviseBlueprintDesign(saved, reference);
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
	const raw = await rconScript(server, blueprintCommand(resolved, player));
	let decoded: unknown;
	try {
		decoded = JSON.parse(raw.trim());
	} catch {
		throw new ServerError(502, 'The server did not return a blueprint result');
	}
	const reply = replySchema.safeParse(decoded);
	if (!reply.success) throw new ServerError(502, 'The server returned an invalid blueprint result');
	if (!reply.data.ok) throw new ServerError(409, reply.data.error);
	if (resolved.operation === 'create') {
		const { operation: _operation, ...design } = resolved;
		const designId = blueprintDesignHash(design);
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
		const artifact = z
			.object({ kind: z.literal('blueprint') })
			.passthrough()
			.parse(reply.data.result);
		return { ...artifact, designId };
	}
	return reply.data.result;
}
