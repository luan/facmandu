// @ts-expect-error Bun supplies this built-in at runtime; the project uses Node type declarations.
import { mock } from 'bun:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { test } from 'node:test';
import { promisify } from 'node:util';

if (process.argv.includes('--selection-probe')) {
	const calls = { codex: 0, copilot: 0 };
	mock.module('../src/lib/server/provider-auth', () => ({
		deriveEfforts: () => {
			throw Error('Unexpected API-provider lookup');
		}
	}));
	mock.module('../src/lib/server/db', () => ({
		db: {
			select: () => ({
				from: () => ({
					where: () => ({
						get: async () => ({ codex: 'connected', copilot: 'connected', meta: null })
					})
				})
			})
		}
	}));
	mock.module('../src/lib/server/assistant-providers', () => ({
		accountProviderKeys: async () => new Map(),
		apiProviders: [],
		accountProviderKey: () => {
			throw Error('Unexpected key lookup');
		},
		apiProviderAuth: () => {
			throw Error('Unexpected authentication');
		}
	}));
	mock.module('../src/lib/server/codex', () => ({
		codexProvider: {},
		codexAccessToken: async () => 'fixture-token',
		codexModels: () => {
			calls.codex++;
			return [{ id: 'gpt-6-luna', name: 'Luna', efforts: ['low'], defaultEffort: 'low' }];
		}
	}));
	mock.module('../src/lib/server/copilot', () => ({
		copilotProvider: {},
		copilotAccessToken: async () => 'fixture-token',
		copilotModelAuth: async () => ({}),
		copilotModels: () => {
			calls.copilot++;
			throw Error('Unrelated catalog unavailable');
		}
	}));
	mock.module('../src/lib/server/meta', () => ({
		metaProvider: {},
		metaAccessToken: () => Promise.resolve('fixture-token'),
		metaModels: () => []
	}));
	const { loadAssistantModel } = await import('../src/lib/server/assistant-models');
	const loaded = await loadAssistantModel('fixture-user', 'gpt-6-luna');
	assert.equal(loaded.entry.id, 'gpt-6-luna');
	assert.equal(loaded.entry.provider, 'codex');
	assert.deepEqual(calls, { codex: 1, copilot: 0 });
	await assert.rejects(
		loadAssistantModel('fixture-user', 'gpt-unavailable'),
		/Choose an available model/
	);
	assert.deepEqual(calls, { codex: 2, copilot: 0 });
	await assert.rejects(
		loadAssistantModel('fixture-user', 'copilot:quick'),
		/Unrelated catalog unavailable/
	);
	assert.deepEqual(calls, { codex: 2, copilot: 1 });
} else {
	test('loading a selected model ignores unrelated provider failures and fetches its catalog once', async () => {
		// Isolate account/provider fixtures from the rest of the process's module registry.
		await promisify(execFile)(process.execPath, [import.meta.filename, '--selection-probe']);
	});
}
