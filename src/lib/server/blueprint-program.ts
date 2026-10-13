import { spawn } from 'node:child_process';
import { z } from 'zod';
import { blueprintDesignSchema } from '$lib/blueprints';
import source from './blueprint-program-worker.mjs?raw';
import { ServerError } from './server-files';

export async function runBlueprintProgram(
	program: string,
	design: z.infer<typeof blueprintDesignSchema>
) {
	const output = await new Promise<string>((resolve, reject) => {
		const child = spawn(
			'node',
			['--max-old-space-size=64', '--input-type=module', '--eval', source],
			{
				env: { PATH: process.env.PATH },
				stdio: ['pipe', 'pipe', 'ignore']
			}
		);
		let output = '';
		const deadline = setTimeout(() => child.kill('SIGKILL'), 2000);
		child.on('error', reject);
		child.stdout.on('data', (chunk: Buffer) => {
			output += chunk.toString();
			if (Buffer.byteLength(output) > 128000) child.kill('SIGKILL');
		});
		child.on('close', (code) => {
			clearTimeout(deadline);
			if (code === 0) resolve(output);
			else reject(new ServerError(400, 'Layout program exceeded its execution or memory limit'));
		});
		child.stdin.on('error', () => {});
		child.stdin.end(JSON.stringify({ program, design }));
	});
	const reply = z
		.discriminatedUnion('ok', [
			z.object({ ok: z.literal(true), design: z.unknown() }),
			z.object({ ok: z.literal(false), error: z.string() })
		])
		.parse(JSON.parse(output));
	if (!reply.ok) throw new ServerError(400, reply.error);
	const compiled = blueprintDesignSchema.safeParse(reply.design);
	if (!compiled.success)
		throw new ServerError(
			400,
			`Invalid generated layout: ${compiled.error.issues
				.slice(0, 3)
				.map((i) => `${i.path.join('.')}: ${i.message}`)
				.join('; ')}`
		);
	if (compiled.data.force !== design.force)
		throw new ServerError(403, 'Layout program cannot change its force');
	return compiled.data;
}
