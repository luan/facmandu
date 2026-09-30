// @ts-expect-error Bun supplies this built-in at runtime; the project uses Node type declarations.
import { mock, test } from 'bun:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

if (process.env.FACMANDU_PREVIEW_TEST_CHILD !== '1') {
	test('map preview publication', async () => {
		const result = await promisify(execFile)(
			process.execPath,
			['test', fileURLToPath(import.meta.url)],
			{ env: { ...process.env, FACMANDU_PREVIEW_TEST_CHILD: '1' } }
		);
		assert.match(result.stdout + result.stderr, /0 fail/u);
	});
} else {
	const original = { ...fs };
	const png = Buffer.from(
		'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=',
		'base64'
	);
	const isPreviewFile = (path: unknown): path is string =>
		typeof path === 'string' && dirname(path).endsWith(`${sep}previews`);
	let beforePublish: (() => Promise<void>) | undefined;
	let failPublication = false;
	mock.module('node:fs/promises', () => ({
		...original,
		writeFile: async (...args: Parameters<typeof fs.writeFile>) => {
			if (isPreviewFile(args[0]) && beforePublish) {
				await original.writeFile(args[0], png.subarray(0, 8), args[2]);
				await beforePublish();
			}
			return original.writeFile(...args);
		},
		rename: async (...args: Parameters<typeof fs.rename>) => {
			if (isPreviewFile(args[1]) && failPublication) {
				failPublication = false;
				throw Object.assign(new Error('Fixture publication failure'), { code: 'EIO' });
			}
			return await original.rename(...args);
		}
	}));
	let binary = '';
	mock.module('../src/lib/server/server-process', () => ({ executable: async () => binary }));
	const { mapGenerationPreview } = await import('../src/lib/server/map-generation-native');
	const { initializeServer, updateServerConfig } = await import('../src/lib/server/server-files');

	async function fixture() {
		const directory = await original.mkdtemp(join(tmpdir(), 'facmandu-preview-'));
		const server = {
			id: directory,
			name: 'Test',
			directory,
			gamePort: 34197,
			rconPort: 27015,
			selectedModlist: null
		};
		const previousPath = process.env.PATH;
		try {
			await initializeServer(server);
			await updateServerConfig(server, { version: { branch: 'experimental', version: '2.1.20' } });
			const installation = join(directory, 'installation');
			binary = join(installation, 'bin', 'x64', 'factorio');
			await original.mkdir(dirname(binary), { recursive: true });
			await original.mkdir(join(installation, 'data'));
			await original.writeFile(join(installation, 'data', 'map-gen-settings.example.json'), '{}');
			await original.writeFile(join(installation, 'data', 'map-settings.example.json'), '{}');
			await original.writeFile(join(directory, 'fixture.png'), png);
			// A native CLI fixture exercises catalog discovery without duplicating cache keys.
			await original.writeFile(
				binary,
				`#!/bin/sh
while [ "$#" -gt 0 ]; do
  case "$1" in
    --help) printf '%s\\n' --generate-map-preview; exit 0 ;;
    --config) config="$2"; shift ;;
    --generate-map-preview) cp "${directory}/fixture.png" "$2"; exit 0 ;;
    --dump-data)
      output="$(dirname "$config")/write/script-output"
      mkdir -p "$output"
      printf '%s' '{"autoplace-control":{},"map-gen-presets":{"default":{"default":{}}}}' > "$output/data-raw-dump.json"
      exit 0 ;;
    --dump-prototype-locale) exit 0 ;;
  esac
  shift
done
exit 1
`
			);
			await original.chmod(binary, 0o700);
			const xvfb = join(directory, 'xvfb-run');
			await original.writeFile(xvfb, '#!/bin/sh\nshift\nexec "$@"\n');
			await original.chmod(xvfb, 0o700);
			process.env.PATH = `${directory}:${previousPath ?? ''}`;
			return { server, cache: join(directory, 'map-generation-cache', 'previews'), close };
		} catch (cause) {
			await close();
			throw cause;
		}
		async function close() {
			beforePublish = undefined;
			failPublication = false;
			if (previousPath === undefined) delete process.env.PATH;
			else process.env.PATH = previousPath;
			await original.rm(directory, { recursive: true, force: true });
		}
	}

	test('concurrent requests receive complete PNGs and no partial image is published', async () => {
		const { server, cache, close } = await fixture();
		const started = Promise.withResolvers<void>();
		const release = Promise.withResolvers<void>();
		beforePublish = () => {
			started.resolve();
			return release.promise;
		};
		let requests: Promise<Buffer>[] = [];
		try {
			const first = mapGenerationPreview(server, { seed: 1 });
			requests = [first];
			await Promise.race([
				started.promise,
				first.then(() => assert.fail('Publication was not gated'))
			]);
			assert.deepEqual(
				(await original.readdir(cache)).filter((name) => name.endsWith('.png')),
				[]
			);
			requests.push(mapGenerationPreview(server, { seed: 1 }));
			release.resolve();
			for (const result of await Promise.all(requests)) assert.deepEqual(result, png);
			const files = await original.readdir(cache);
			assert.equal(files.length, 1);
			assert.ok(files[0]?.endsWith('.png'));
			assert.deepEqual(await original.readFile(join(cache, files[0] ?? '')), png);
			assert.deepEqual(await mapGenerationPreview(server, { seed: 1 }), png);
		} finally {
			release.resolve();
			await Promise.allSettled(requests);
			await close();
		}
	});

	test('failed publication removes its temporary file and releases the preview for retry', async () => {
		const { server, cache, close } = await fixture();
		try {
			failPublication = true;
			await assert.rejects(mapGenerationPreview(server, { seed: 2 }), {
				status: 503,
				message: 'Factorio map preview failed'
			});
			assert.deepEqual(await original.readdir(cache), []);
			assert.deepEqual(await mapGenerationPreview(server, { seed: 2 }), png);
			const files = await original.readdir(cache);
			assert.equal(files.length, 1);
			assert.ok(files[0]?.endsWith('.png'));
			assert.deepEqual(await original.readFile(join(cache, files[0] ?? '')), png);
		} finally {
			await close();
		}
	});
}
