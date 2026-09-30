// @ts-expect-error Bun supplies this built-in at runtime; the project uses Node type declarations.
import { mock, test } from 'bun:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { Param, type SQL } from 'drizzle-orm';
import { lauxlib, lua, lualib, to_luastring } from 'fengari';
import { strToU8, zipSync } from 'fflate';

// Bun module mocks persist across test files. Run these focused mocks in a
// child so the real RCON tests can import the real module.
if (process.env.FACMANDU_DEFS_TEST_CHILD !== '1') {
	test('mod settings definitions', async () => {
		const result = await promisify(execFile)(
			process.execPath,
			['test', fileURLToPath(import.meta.url)],
			{ env: { ...process.env, FACMANDU_DEFS_TEST_CHILD: '1' } }
		);
		assert.match(result.stdout + result.stderr, /0 fail/u);
	});
} else {
	mock.module('$env/dynamic/private', () => ({ env: {} }));
	let running = false;
	let liveResponse = '';
	let liveCommand = '';
	let liveResponses: string[] = [];
	let liveCommands: string[] = [];
	mock.module('../src/lib/server/server-process', () => ({
		serverStatus: async () => ({ running }),
		executable: async () => null,
		requireStopped: async () => undefined
	}));
	mock.module('../src/lib/server/server-rcon', () => ({
		rconScript: (_server: unknown, command: string) => {
			liveCommand = command;
			liveCommands.push(command);
			return Promise.resolve(liveResponses.shift() ?? liveResponse);
		}
	}));
	const { mod: modTable } = await import('../src/lib/server/db/schema');
	const cache = new Map<string, string>();
	const modMetadata = new Map<string, { title: string | null; thumbnail: string | null }>();
	let cacheWriteCalls = 0;
	let selectedKey = '';
	let selectedTable: unknown;
	const chain = () => {
		const self: Record<string, unknown> = {};
		self.select = () => self;
		self.from = (table: unknown) => {
			selectedTable = table;
			return self;
		};
		self.where = (condition: SQL) => {
			const parameter = condition.queryChunks.find((chunk) => chunk instanceof Param);
			selectedKey =
				parameter instanceof Param && typeof parameter.value === 'string' ? parameter.value : '';
			return self;
		};
		self.get = () =>
			Promise.resolve(cache.has(selectedKey) ? { body: cache.get(selectedKey) } : undefined);
		self.all = () =>
			Promise.resolve(
				selectedTable === modTable
					? [...modMetadata.entries()].map(([name, values]) => ({ name, ...values }))
					: [...cache.entries()]
							.filter(([key]) => key.startsWith('mod:'))
							.map(([key, body]) => ({ key, body }))
			);
		self.insert = () => self;
		self.values = (value: { key: string; body: string } | { key: string; body: string }[]) => {
			cacheWriteCalls += 1;
			for (const v of Array.isArray(value) ? value : [value]) cache.set(v.key, v.body);
			return self;
		};
		self.onConflictDoUpdate = () => self;
		return self;
	};
	mock.module('../src/lib/server/db', () => ({
		db: chain(),
		userHasModlistAccess: async () => false
	}));
	const { modSettingDef, modSettingsCatalog, liveModSettings, saveLiveModSettings } = await import(
		'../src/lib/server/mod-settings-defs'
	);

	const LUA = `data:extend({
  { type = "bool-setting", name = "t-flag", setting_type = "startup", default_value = true },
  { type = "string-setting", name = "t-choice", setting_type = "runtime-global", default_value = "a", allowed_values = {"a", "b"} },
})`;
	const LOCALE = `[mod-setting-name]
t-flag=Test flag
t-choice=Test choice
[mod-setting-description]
t-flag=Shown in the server settings
[string-mod-setting]
t-choice-a=First choice
t-choice-b=Second choice
`;

	async function fixture() {
		const dir = await mkdtemp(join(tmpdir(), 'srv-'));
		await mkdir(join(dir, 'mods'));
		await writeFile(
			join(dir, 'mods', 'testmod_1.0.0.zip'),
			zipSync({
				'testmod/settings.lua': strToU8(LUA),
				'testmod/locale/en/settings.cfg': strToU8(LOCALE)
			})
		);
		await writeFile(
			join(dir, 'mods', 'testmod_2.0.0.zip'),
			zipSync({
				'testmod/settings.lua': strToU8(LUA),
				'testmod/locale/en/settings.cfg': strToU8(LOCALE)
			})
		);
		await writeFile(
			join(dir, 'mods', 'nosettings_1.0.0.zip'),
			zipSync({ 'nosettings/info.json': strToU8('{}') })
		);
		await mkdir(join(dir, 'mods', 'unpackedmod'));
		await writeFile(
			join(dir, 'mods', 'unpackedmod', 'settings.lua'),
			'local x = require("../outside")\ndata:extend({{ type = "bool-setting", name = "u-flag", setting_type = "startup", default_value = x ~= nil }})'
		);
		await writeFile(join(dir, 'outside.lua'), 'error("escaped the mod directory")');
		await mkdir(join(dir, 'mods', 'empty-unpacked'));
		await writeFile(join(dir, 'mods', 'empty-unpacked', 'info.json'), '{}');
		await writeFile(
			join(dir, 'mods', 'brokenmod_1.0.0.zip'),
			zipSync({ 'brokenmod/settings.lua': strToU8('this is invalid lua ((( ') })
		);
		await writeFile(
			join(dir, 'mods', 'mod-list.json'),
			JSON.stringify({
				mods: [
					{ name: 'testmod', enabled: true, version: '2.0.0' },
					{ name: 'nosettings', enabled: true, version: '1.0.0' },
					{ name: 'brokenmod', enabled: true, version: '1.0.0' },
					{ name: 'disabled', enabled: false, version: '1.0.0' }
				]
			})
		);
		return dir;
	}

	test('stopped catalog shows only enabled installed mods with definitions and preserves failures', async () => {
		const dir = await fixture();
		const server = { directory: dir, selectedModlist: 'list-1' } as never;
		modMetadata.set('testmod', { title: 'Local Mod', thumbnail: '/local.png' });
		cache.set('mod:testmod', JSON.stringify({ title: 'Test Mod', thumbnail: '/test.png' }));
		try {
			const catalog = await modSettingsCatalog(server);
			assert.deepEqual(
				catalog.mods.map(({ name, title, thumbnail, version, defs }) => ({
					name,
					title,
					thumbnail,
					version,
					default: defs[0]?.default
				})),
				[
					{
						name: 'testmod',
						title: 'Test Mod',
						thumbnail: '/test.png',
						version: '2.0.0',
						default: true
					}
				]
			);
			assert.deepEqual(catalog.unavailable, ['brokenmod']);
			cache.delete('mod:testmod');
			const local = await modSettingsCatalog(server);
			assert.equal(local.mods[0]?.title, 'Local Mod');
			assert.equal(local.mods[0]?.thumbnail, '/local.png');
		} finally {
			cache.clear();
			modMetadata.clear();
			await rm(dir, { recursive: true, force: true });
		}
	});

	test('running catalog reads owners, caches exact defaults, and reuses them stopped', async () => {
		const dir = await fixture();
		const server = { directory: dir } as never;
		try {
			running = true;
			liveCommands = [];
			cacheWriteCalls = 0;
			liveResponse = JSON.stringify({
				items: [
					{
						owner: 'testmod',
						version: '2.0.0',
						def: {
							name: 't-flag',
							type: 'bool-setting',
							setting_type: 'startup',
							default_value: false,
							localised_name: ['setting-name.t-flag']
						}
					},
					{
						owner: 'other-mod',
						version: '1.0.0',
						def: {
							name: 'other-flag',
							type: 'bool-setting',
							setting_type: 'startup',
							default_value: true
						}
					}
				]
			});
			const live = await modSettingsCatalog(server);
			assert.equal(liveCommands.length, 1);
			assert.match(liveCommands[0] ?? '', /prototypes\.mod_setting/u);
			assert.deepEqual(
				live.mods.map(({ name, defs }) => [name, defs[0]?.default]),
				[
					['other-mod', true],
					['testmod', false]
				]
			);
			assert.deepEqual(live.unavailable, []);
			assert.ok(cache.has('mod-settings-defs:v3:testmod:2.0.0:unknown'));
			assert.ok(cache.has('mod-settings-defs:v3:other-mod:1.0.0:unknown'));
			assert.equal(cacheWriteCalls, 1);
			running = false;
			const stopped = await modSettingsCatalog(server);
			assert.equal(stopped.mods[0]?.defs[0]?.default, false);
			assert.deepEqual(stopped.mods[0]?.defs[0]?.localisedName, ['setting-name.t-flag']);
		} finally {
			running = false;
			cache.clear();
			await rm(dir, { recursive: true, force: true });
		}
	});

	test('running catalog accepts an empty Factorio Lua table', async () => {
		running = true;
		liveResponse = JSON.stringify({ items: {} });
		try {
			assert.deepEqual(await modSettingsCatalog({ directory: '/missing' } as never), {
				mods: [],
				unavailable: []
			});
		} finally {
			running = false;
		}
	});

	test('running catalog aggregates bounded pages and stops at the final cursor', async () => {
		running = true;
		liveCommands = [];
		liveResponses = [
			JSON.stringify({
				items: [
					{
						owner: 'testmod',
						version: '2.0.0',
						def: {
							name: 'first',
							type: 'bool-setting',
							setting_type: 'startup',
							default_value: true
						}
					}
				],
				next: 2
			}),
			JSON.stringify({
				items: [
					{
						owner: 'testmod',
						version: '2.0.0',
						def: {
							name: 'second',
							type: 'int-setting',
							setting_type: 'runtime-global',
							default_value: 2
						}
					}
				]
			})
		];
		try {
			const catalog = await modSettingsCatalog({ directory: '/missing' } as never);
			assert.deepEqual(
				catalog.mods[0]?.defs.map((def) => def.name),
				['first', 'second']
			);
			assert.equal(liveCommands.length, 2);
			assert.match(liveCommands[0] ?? '', /local cursor = 1/u);
			assert.match(liveCommands[1] ?? '', /local cursor = 2/u);
			assert.match(liveCommands[0] ?? '', /#encoded > 32768/u);
		} finally {
			running = false;
			liveResponses = [];
			cache.clear();
		}
	});

	test('prefers the newest archive, parses defs, and caches per version', async () => {
		const dir = await fixture();
		try {
			const parsed = await modSettingDef({ directory: dir } as never, 'testmod');
			assert.equal(parsed?.version, '2.0.0');
			assert.equal(parsed?.defs[0]?.default, true);
			assert.equal(parsed?.defs[0]?.label, 'Test flag');
			assert.equal(parsed?.defs[0]?.description, 'Shown in the server settings');
			assert.deepEqual(parsed?.defs[1]?.allowedLabels, {
				a: 'First choice',
				b: 'Second choice'
			});
			assert.ok(cache.has('mod-settings-defs:v3:testmod:2.0.0:unknown'));
			const empty = await modSettingDef({ directory: dir } as never, 'nosettings');
			assert.deepEqual(empty?.defs, []);
			const emptyUnpacked = await modSettingDef({ directory: dir } as never, 'empty-unpacked');
			assert.deepEqual(emptyUnpacked?.defs, []);
			assert.equal(await modSettingDef({ directory: dir } as never, 'brokenmod'), null);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test('reads the running game prototypes owned by the selected mod', async () => {
		running = true;
		liveResponse = JSON.stringify({
			selectedVersion: '3.2.1',
			items: [
				{
					owner: 'testmod',
					version: '3.2.1',
					def: {
						name: 'test-level',
						type: 'int-setting',
						setting_type: 'runtime-global',
						default_value: 2,
						localised_name: ['setting-name.test-level'],
						localised_description: ['setting-description.test-level'],
						allowed_values: [1, 2, 3],
						order: 'a'
					}
				},
				{
					owner: 'testmod',
					version: '3.2.1',
					def: {
						name: 'test-tint',
						type: 'color-setting',
						setting_type: 'startup',
						default_value: { r: 1, g: 0.5, b: 0 }
					}
				}
			]
		});
		try {
			const parsed = await modSettingDef({ directory: '/missing' } as never, 'testmod');
			assert.equal(parsed?.version, '3.2.1');
			assert.deepEqual(
				parsed?.defs.map(({ name, default: value, allowed }) => ({ name, value, allowed })),
				[
					{ name: 'test-level', value: 2, allowed: [1, 2, 3] },
					{ name: 'test-tint', value: { r: 1, g: 0.5, b: 0, a: 1 }, allowed: undefined }
				]
			);
			assert.match(liveCommand, /prototype\.mod == selected/u);
			assert.match(liveCommand, /prototypes\.mod_setting/u);
			assert.deepEqual(parsed?.defs[0]?.localisedName, ['setting-name.test-level']);
			assert.deepEqual(parsed?.defs[0]?.localisedDescription, ['setting-description.test-level']);
		} finally {
			running = false;
		}
	});

	test('reuses live definitions after stop only for the matching mod and game versions', async () => {
		const dir = await fixture();
		const server = { directory: dir } as never;
		const configPath = join(dir, 'facmandu.json');
		const config = (version: string) =>
			JSON.stringify({
				version: { branch: 'stable', version },
				rconPassword: '1234567890123456'
			});
		try {
			await writeFile(configPath, config('2.1.20'));
			running = true;
			liveResponse = JSON.stringify({
				selectedVersion: '2.0.0',
				items: [
					{
						owner: 'testmod',
						version: '2.0.0',
						def: {
							name: 't-flag',
							type: 'bool-setting',
							setting_type: 'startup',
							default_value: false
						}
					}
				]
			});
			assert.equal((await modSettingDef(server, 'testmod'))?.defs[0]?.default, false);
			assert.ok(cache.has('mod-settings-defs:v3:testmod:2.0.0:2.1.20'));
			running = false;
			assert.equal((await modSettingDef(server, 'testmod'))?.defs[0]?.default, false);
			await writeFile(configPath, config('2.1.21'));
			assert.equal((await modSettingDef(server, 'testmod'))?.defs[0]?.default, true);
		} finally {
			running = false;
			await rm(dir, { recursive: true, force: true });
		}
	});

	test('does not claim missing or failed live prototypes are empty settings', async () => {
		running = true;
		try {
			liveResponse = JSON.stringify({ items: [] });
			assert.equal(await modSettingDef({ directory: '/missing' } as never, 'testmod'), null);
			liveResponse = JSON.stringify({ error: 'prototype query failed' });
			await assert.rejects(modSettingDef({ directory: '/missing' } as never, 'testmod'));
		} finally {
			running = false;
		}
	});

	test('reads scoped live values without writing saved settings', async () => {
		liveResponse = JSON.stringify({
			values: {
				startup: { flag: { value: true } },
				'runtime-global': { tint: { value: { r: 1, g: 0, b: 0 } } },
				'runtime-per-user': { scale: { value: 2 } }
			}
		});
		const values = await liveModSettings({ directory: '/missing' } as never);
		assert.deepEqual(values['runtime-global'].tint?.value, { r: 1, g: 0, b: 0 });
		assert.equal(values['runtime-per-user'].scale?.value, 2);
		assert.match(liveCommand, /settings\.player_default/u);
		liveResponse = JSON.stringify({
			values: { startup: [], 'runtime-global': [], 'runtime-per-user': [] }
		});
		assert.deepEqual(await liveModSettings({ directory: '/missing' } as never), {
			startup: {},
			'runtime-global': {},
			'runtime-per-user': {}
		});
	});

	test('live updates reject startup settings and stopped servers before RCON', async () => {
		liveCommand = '';
		await assert.rejects(
			saveLiveModSettings({ directory: '/missing' } as never, {
				startup: { flag: { value: true } }
			}),
			{ status: 409 }
		);
		assert.equal(liveCommand, '');
		await assert.rejects(
			saveLiveModSettings({ directory: '/missing' } as never, {
				'runtime-per-user': { flag: { value: true } }
			}),
			{ status: 409 }
		);
		assert.equal(liveCommand, '');
		await assert.rejects(
			saveLiveModSettings({ directory: '/missing' } as never, {
				'runtime-global': { flag: { value: true } }
			}),
			{ status: 409 }
		);
		assert.equal(liveCommand, '');
	});

	test('validates all settings before dispatching to each exact owner', async () => {
		running = true;
		liveCommands = [];
		const changes = { 'runtime-global': { first: { value: true }, second: { value: 2 } } };
		try {
			liveResponses = [
				JSON.stringify({
					ok: true,
					items: [
						{ owner: 'Milestones', scope: 'runtime-global', name: 'first', previous: false },
						{ owner: 'OtherMod', scope: 'runtime-global', name: 'second', previous: 1 }
					]
				}),
				JSON.stringify({ ok: true, count: 1 }),
				JSON.stringify({ ok: true, count: 1 })
			];
			assert.equal(await saveLiveModSettings({ directory: '/missing' } as never, changes), 2);
			assert.equal(liveCommands.length, 3);
			assert.match(
				liveCommands[0] ?? '',
				/^\/silent-command local changes = helpers\.json_to_table/u
			);
			assert.match(liveCommands[1] ?? '', /^\/silent-command __Milestones__ /u);
			assert.match(liveCommands[2] ?? '', /^\/silent-command __OtherMod__ /u);
			liveCommands = [];
			liveResponses = [JSON.stringify({ ok: false, error: 'Value is not allowed: first' })];
			await assert.rejects(saveLiveModSettings({ directory: '/missing' } as never, changes), {
				status: 400,
				message: 'Value is not allowed: first'
			});
			assert.equal(liveCommands.length, 1);
		} finally {
			running = false;
			liveResponses = [];
		}
	});

	test('rolls back completed and failing owners, reporting rollback failures', async () => {
		running = true;
		liveCommands = [];
		const changes = { 'runtime-global': { first: { value: true }, second: { value: 2 } } };
		const validation = JSON.stringify({
			ok: true,
			items: [
				{ owner: 'Milestones', scope: 'runtime-global', name: 'first', previous: false },
				{ owner: 'OtherMod', scope: 'runtime-global', name: 'second', previous: 1 }
			]
		});
		try {
			liveResponses = [
				validation,
				JSON.stringify({ ok: true, count: 1 }),
				JSON.stringify({ ok: false, error: 'write failed\nLua detail' }),
				JSON.stringify({ ok: true, count: 1 }),
				JSON.stringify({ ok: true, count: 1 })
			];
			await assert.rejects(saveLiveModSettings({ directory: '/missing' } as never, changes), {
				status: 502,
				message: 'OtherMod: write failed; previous values were restored'
			});
			assert.deepEqual(
				liveCommands
					.slice(1)
					.map((command) => command.match(/^\/silent-command __([^_]+)__/u)?.[1]),
				['Milestones', 'OtherMod', 'OtherMod', 'Milestones']
			);
			liveResponses = [
				validation,
				JSON.stringify({ ok: true, count: 1 }),
				JSON.stringify({ ok: false, error: 'write failed\nLua detail' }),
				JSON.stringify({ ok: false, error: 'rollback failed' }),
				JSON.stringify({ ok: true, count: 1 })
			];
			await assert.rejects(saveLiveModSettings({ directory: '/missing' } as never, changes), {
				status: 502,
				message: 'OtherMod: write failed; rollback failed for OtherMod'
			});
		} finally {
			running = false;
			liveResponses = [];
		}
	});

	test('live Lua validates the whole patch without changing settings', async () => {
		running = true;
		try {
			liveResponses = [JSON.stringify({ ok: false, error: 'probe' })];
			await assert.rejects(
				saveLiveModSettings({ directory: '/missing' } as never, {
					'runtime-global': { flag: { value: true }, level: { value: 2 } }
				})
			);
			const command = liveCommand.slice('/silent-command '.length);
			const run = (level: number, expected: string, allowed = '{1, 2}') => {
				const state = lauxlib.luaL_newstate();
				lualib.luaL_openlibs(state);
				const execute = (source: string) => {
					const status = lauxlib.luaL_dostring(state, to_luastring(source));
					assert.equal(status, lua.LUA_OK, lua.lua_tojsstring(state, -1));
				};
				execute(`
helpers = {
  json_to_table = function() return {
    startup = {}, ["runtime-global"] = {
      flag = { value = true }, level = { value = ${level} }
    }, ["runtime-per-user"] = {}
  } end,
  table_to_json = function(reply) return reply.ok and "ok" or reply.error end
}
prototypes = { mod_setting = {
  flag = { mod = "Milestones", setting_type = "runtime-global", type = "bool-setting" },
  level = { mod = "OtherMod", setting_type = "runtime-global", type = "int-setting",
    minimum_value = 1, maximum_value = 2, allowed_values = ${allowed} }
} }
settings = { global = { flag = { value = false }, level = { value = 1 } } }
rcon = { print = function(value) output = value end }
`);
				execute(command);
				execute(expected);
			};
			for (const [level, reason, allowed] of [
				[1.5, 'Expected int-setting', '{1, 2}'],
				[0, 'Below minimum', '{1, 2}'],
				[9, 'Above maximum', '{1, 2}'],
				[2, 'Value is not allowed', '{1}']
			] as const) {
				run(
					level,
					`assert(string.find(output, "${reason}", 1, true)) assert(settings.global.flag.value == false) assert(settings.global.level.value == 1)`,
					allowed
				);
			}
			run(
				2,
				'assert(output == "ok") assert(settings.global.flag.value == false) assert(settings.global.level.value == 1)'
			);
		} finally {
			running = false;
			liveResponses = [];
		}
	});

	test('owned Lua skips equal values and reads back changed values', async () => {
		running = true;
		try {
			liveResponses = [
				JSON.stringify({
					ok: true,
					items: [{ owner: 'Milestones', scope: 'runtime-global', name: 'flag', previous: false }]
				}),
				JSON.stringify({ ok: true, count: 1 })
			];
			await saveLiveModSettings({ directory: '/missing' } as never, {
				'runtime-global': { flag: { value: true } }
			});
			const command = liveCommand.slice('/silent-command __Milestones__ '.length);
			const run = (initial: boolean | string, expected: string) => {
				const state = lauxlib.luaL_newstate();
				lualib.luaL_openlibs(state);
				const execute = (source: string) => {
					const status = lauxlib.luaL_dostring(state, to_luastring(source));
					assert.equal(status, lua.LUA_OK, lua.lua_tojsstring(state, -1));
				};
				execute(`
script = { mod_name = "Milestones" }
helpers = {
  json_to_table = function() return {{ scope = "runtime-global", name = "flag", value = true, expected = false }} end,
  table_to_json = function(reply) return reply.ok and tostring(reply.count) or reply.error end
}
prototypes = { mod_setting = { flag = { mod = "Milestones", setting_type = "runtime-global" } } }
writes = 0
local backing = { flag = { value = ${JSON.stringify(initial)} } }
settings = { global = setmetatable({}, {
  __index = function(_, key) return backing[key] end,
  __newindex = function(_, key, value) writes = writes + 1 backing[key] = value end
}) }
rcon = { print = function(value) output = value end }
`);
				execute(command);
				execute(expected);
			};
			run(true, 'assert(output == "0") assert(writes == 0)');
			run(
				false,
				'assert(output == "1") assert(writes == 1) assert(settings.global.flag.value == true)'
			);
			run(
				'other',
				'assert(string.find(output, "Setting changed during update", 1, true)) assert(writes == 0) assert(settings.global.flag.value == "other")'
			);
		} finally {
			running = false;
			liveResponses = [];
		}
	});

	test('reads unpacked mods without escaping their directory', async () => {
		const dir = await fixture();
		try {
			const parsed = await modSettingDef({ directory: dir } as never, 'unpackedmod');
			assert.equal(parsed?.version, 'unpacked');
			assert.equal(parsed?.defs[0]?.default, true);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test('rejects unknown and invalid mod names', async () => {
		const dir = await fixture();
		try {
			const server = { directory: dir } as never;
			assert.equal(await modSettingDef(server, 'missing'), null);
			assert.equal(await modSettingDef(server, '../outside'), null);
			assert.equal(await modSettingDef(server, 'base'), null);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
}
