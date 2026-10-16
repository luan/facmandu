import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { ServerError } from './server-files';

const id = z.string().regex(/^[a-f0-9]{64}$/u);
const statusSchema = z.object({ force: z.string(), passed: z.boolean() });
function path(directory: string, designId: string) {
	return join(directory, 'factory-layouts', `${id.parse(designId)}.json`);
}
async function read(directory: string, designId: string) {
	try {
		return statusSchema.parse(JSON.parse(await readFile(path(directory, designId), 'utf8')));
	} catch (cause) {
		if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
		throw new ServerError(409, 'Cannot verify this compiled factory’s sandbox qualification');
	}
}
export async function markCompiledFactory(directory: string, force: string, designId: string) {
	await mkdir(join(directory, 'factory-layouts'), { recursive: true, mode: 0o700 });
	await writeFile(path(directory, designId), JSON.stringify({ force, passed: false }), {
		mode: 0o600
	});
}
export async function recordCompiledFactoryTrial(
	directory: string,
	force: string,
	result: unknown
) {
	const parsed = z
		.object({ designId: id, status: z.string(), passed: z.boolean().optional() })
		.safeParse(result);
	if (!parsed.success || parsed.data.status !== 'done') return;
	const current = await read(directory, parsed.data.designId);
	if (!current) return; // Community/legacy blueprints keep their existing placement workflow.
	if (current.force !== force) throw new ServerError(403, 'Factory trial belongs to another force');
	await writeFile(
		path(directory, parsed.data.designId),
		JSON.stringify({ force, passed: parsed.data.passed === true }),
		{ mode: 0o600 }
	);
}
export async function requireCompiledFactoryTrial(
	directory: string,
	force: string,
	designId: string
) {
	const current = await read(directory, designId);
	if (!current) return;
	if (current.force !== force)
		throw new ServerError(403, 'Compiled factory belongs to another force');
	if (!current.passed)
		throw new ServerError(
			409,
			'This compiled factory has not passed its native throughput trial; ghosts were not placed'
		);
}
