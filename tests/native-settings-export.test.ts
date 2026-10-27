// @ts-expect-error Bun supplies this built-in at runtime.
import { mock, test } from 'bun:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { emptyPrivateEnv } from './fixtures/app-env';

if (process.env.FACMANDU_NATIVE_SETTINGS_CHILD !== '1') {
	test('native settings export', async () => {
		const result = await promisify(execFile)(
			process.execPath,
			['test', fileURLToPath(import.meta.url)],
			{ env: { ...process.env, FACMANDU_NATIVE_SETTINGS_CHILD: '1' } }
		);
		assert.match(result.stdout + result.stderr, /0 fail/u);
	});
} else {
	mock.module('$app/env/private', emptyPrivateEnv);
	const { initializeServer, updateServerConfig } = await import('../src/lib/server/server-files');
	const { nativeModSettingPrototypes } = await import('../src/lib/server/map-generation-native');
	const { parseNativeModSettings } = await import('../src/lib/server/mod-settings-lua');
	test('exports real CLI settings in an isolated profile and invalidates cached definitions when mods change', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'native-settings-'));
		const previousPath = process.env.PATH;
		const server = {
			id: 'native-test',
			name: 'Test',
			directory,
			gamePort: 34197,
			rconPort: 27015,
			selectedModlist: null
		};
		try {
			await initializeServer(server);
			await updateServerConfig(server, { version: { branch: 'experimental', version: '2.1.21' } });
			const binary = join(directory, 'versions/experimental/2.1.21/bin/x64/factorio');
			await mkdir(dirname(binary), { recursive: true });
			await writeFile(
				binary,
				`#!/bin/sh
config="$2"
output="$(dirname "$config")/write/script-output"
mkdir -p "$output"
printf '%s' '{"color-setting":{"color":{"name":"color","type":"color-setting","setting_type":"startup","default_value":[255,128,0]}},"string-setting":{"mode":{"name":"mode","type":"string-setting","setting_type":"startup","default_value":"a","allowed_values":{"first":"a","second":"b"}}}}' > "$output/mod-settings-dump.json"
printf 'x' >> "${directory}/calls"
printf '{}' > "$(dirname "$config")/mods/mod-list.json"
`
			);
			await chmod(binary, 0o700);
			await writeFile(join(directory, 'xvfb-run'), '#!/bin/sh\nshift\nexec "$@"\n');
			await chmod(join(directory, 'xvfb-run'), 0o700);
			process.env.PATH = `${directory}:${previousPath ?? ''}`;
			const before = await readFile(join(directory, 'mods/mod-list.json'));
			const first = parseNativeModSettings(await nativeModSettingPrototypes(server));
			assert.deepEqual(first[0]?.default, { r: 1, g: 128 / 255, b: 0, a: 1 });
			assert.deepEqual(first[1]?.allowed, ['a', 'b']);
			assert.deepEqual(await readFile(join(directory, 'mods/mod-list.json')), before);
			assert.deepEqual(parseNativeModSettings(await nativeModSettingPrototypes(server)), first);
			assert.equal(await readFile(join(directory, 'calls'), 'utf8'), 'x');
			await writeFile(
				join(directory, 'mods/mod-list.json'),
				'{"mods":[{"name":"base","enabled":true}]}'
			);
			await nativeModSettingPrototypes(server);
			assert.equal(await readFile(join(directory, 'calls'), 'utf8'), 'xx');
			assert.deepEqual(
				(await readdir(join(directory, 'map-generation-cache'))).filter((name) =>
					name.startsWith('.run-')
				),
				[]
			);
		} finally {
			process.env.PATH = previousPath;
			await rm(directory, { recursive: true, force: true });
		}
	});
}
