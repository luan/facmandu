import { z } from 'zod';
import { factoryLayoutInput } from '$lib/factory-layout';
import type { ManagedServer } from './db/schema';
import { blueprintDesignHash, factoryBlueprint } from './factory-blueprints';
import { compileFactoryLayout } from './factory-layout-compiler';
import packSource from './factory-layout-pack.lua?raw';
import { markCompiledFactory } from './factory-layout-status';
import { factoryTrialContextSchema } from './factory-native-trial';
import { luaString } from './factory-query-bundle';
import { ServerError } from './server-files';
import { serverStatus } from './server-process';
import { rconScript } from './server-rcon';

const modules = Object.fromEntries(
	Object.entries(
		import.meta.glob<string>('./vendor/interpose/engine/**/*.lua', {
			query: '?raw',
			import: 'default',
			eager: true
		})
	).map(([path, source]) => [
		path
			.replace('./vendor/interpose/', '')
			.replace(/\.lua$/u, '')
			.replaceAll('/', '.'),
		source
	])
);

export async function designFactory(
	server: ManagedServer,
	input: unknown,
	actor?: { name: string; requireAdmin: boolean },
	signal?: AbortSignal
) {
	const request = factoryLayoutInput.parse(input);
	if (!(await serverStatus(server)).running)
		throw new ServerError(409, 'Start the server to read its production rules');
	const command = `/silent-command local request=helpers.json_to_table(${luaString(JSON.stringify(request))})
request.trialContext=true
local ok,result=pcall(function() local build=(function() ${packSource} end)() return build(request) end)
local reply=helpers.table_to_json(ok and {ok=true,result=result} or {ok=false,error=tostring(result)})
if #reply>255*1024 then reply=helpers.table_to_json({ok=false,error='Factory snapshot exceeds the RCON frame limit; a paged snapshot is required'}) end
rcon.print(reply)`;
	const reply = z
		.discriminatedUnion('ok', [
			z.object({ ok: z.literal(true), result: z.json() }),
			z.object({ ok: z.literal(false), error: z.string() })
		])
		.parse(JSON.parse((await rconScript(server, command)).trim()));
	if (!reply.ok) throw new ServerError(400, reply.error);
	const { trial_context, ...pack } = z.record(z.string(), z.json()).parse(reply.result);
	const context = factoryTrialContextSchema.parse(trial_context);
	const compiled = await compileFactoryLayout(request, pack, modules, signal);
	await markCompiledFactory(server.directory, request.force, blueprintDesignHash(compiled.design));
	const artifact = await factoryBlueprint(
		server,
		{ operation: 'create', ...compiled.design },
		actor
	);
	return {
		artifact,
		pack,
		context,
		inputs: compiled.inputs,
		steps: compiled.steps,
		ports: compiled.ports,
		warnings: compiled.warnings,
		test: compiled.test
	};
}
