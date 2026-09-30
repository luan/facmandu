// @ts-expect-error Bun supplies this built-in at runtime; the project uses Node type declarations.
import { afterAll, mock, test } from 'bun:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { normalizeContext, type OAuthAuth, type OAuthCredential } from '@earendil-works/pi-ai';
import { createClient } from '@libsql/client';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/libsql';
import { user } from '../src/lib/server/db/schema';

if (process.env.FACMANDU_PROVIDER_TEST_CHILD !== '1') {
	test('provider auth keeps verified keys and account-specific model access', () => {
		const result = spawnSync(process.execPath, ['test', fileURLToPath(import.meta.url)], {
			env: { ...process.env, FACMANDU_PROVIDER_TEST_CHILD: '1' },
			encoding: 'utf8'
		});
		assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
	});
} else {
	const client = createClient({ url: 'file::memory:' });
	await client.executeMultiple(`CREATE TABLE user (
		id TEXT PRIMARY KEY,
		codex_subject TEXT,
		codex_credentials TEXT,
		meta_subject TEXT,
		meta_credentials TEXT,
		copilot_subject TEXT,
		copilot_credentials TEXT
	);
	INSERT INTO user(id) VALUES ('owner');`);
	const db = drizzle(client, { schema: { user } });
	afterAll(() => client.close());
	mock.module('$env/dynamic/private', () => ({ env: {} }));
	mock.module('../src/lib/server/db', () => ({ db }));
	const codexRequests: { key: string; url: string; headers?: HeadersInit }[] = [];
	const codexCatalog = {
		models: [
			{
				slug: 'gpt-6.1-sol',
				display_name: 'GPT-6.1-Sol',
				visibility: 'list',
				priority: 0,
				supported_reasoning_levels: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'].map(
					(effort) => ({ effort })
				),
				default_reasoning_level: 'medium',
				context_window: 272_000,
				input_modalities: ['text', 'image']
			},
			{
				slug: 'future-model',
				display_name: 'Future model',
				visibility: 'list',
				priority: 2,
				supported_reasoning_levels: [{ effort: 'ultra' }],
				default_reasoning_level: 'ultra',
				context_window: 128_000
			},
			{
				slug: 'hidden-model',
				display_name: 'Hidden model',
				visibility: 'hide',
				supported_reasoning_levels: [{ effort: 'medium' }],
				default_reasoning_level: 'medium',
				context_window: 128_000
			}
		]
	};
	mock.module('../src/lib/server/portal-cache', () => ({
		cachedPortalRequest: async (
			key: string,
			url: string,
			schema: { parse: (input: unknown) => unknown },
			_options: unknown,
			request: { headers?: HeadersInit }
		) => {
			codexRequests.push({ key, url, headers: request.headers });
			return { data: await Promise.resolve(schema.parse(codexCatalog)) };
		}
	}));
	const { codexModels, codexProvider } = await import('../src/lib/server/codex');
	const { createProviderAuth } = await import('../src/lib/server/provider-auth');
	const { metaIdentity } = await import('../src/lib/server/meta');
	const { copilotModels, copilotModelAuth } = await import('../src/lib/server/copilot');
	const { loadAssistantModel } = await import('../src/lib/server/assistant-models');
	const expires = Date.now() + 600_000;

	test('Meta identity retains the API key returned by its verification exchange', async () => {
		const originalFetch = globalThis.fetch;
		globalThis.fetch = (input) => {
			assert.equal(input, 'https://api.meta.ai/muse-code/key');
			return Promise.resolve(
				Response.json({ user_email: 'Owner@Example.com', api_key: 'verified-key' })
			);
		};
		try {
			const initial: OAuthCredential = {
				type: 'oauth',
				access: 'initial-key',
				refresh: 'identity-token',
				expires
			};
			const verified = await metaIdentity(initial);
			assert.equal(verified.subject, 'meta:owner@example.com');
			assert.equal(verified.credential.access, 'verified-key');
			assert.equal(verified.credential.refresh, initial.refresh);
			assert.equal(initial.access, 'initial-key');
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	test('finishing a verified login stores its returned key without another identity exchange', async () => {
		let identifications = 0;
		const oauth: OAuthAuth = {
			name: 'Fake Meta',
			login({ notify }) {
				notify({
					type: 'device_code',
					userCode: 'ABC-123',
					verificationUri: 'https://example.com'
				});
				return Promise.resolve({
					type: 'oauth' as const,
					access: 'initial-key',
					refresh: 'identity-token',
					expires
				});
			},
			refresh(credential) {
				return Promise.resolve(credential);
			},
			toAuth(credential) {
				return Promise.resolve({ apiKey: credential.access });
			}
		};
		const routes = createProviderAuth({
			id: 'meta',
			displayName: 'Muse',
			issuerName: 'Meta',
			oauth,
			answerPrompt: () => Promise.resolve('device_code'),
			identify: (credential) => {
				identifications++;
				return {
					subject: 'meta:owner@example.com',
					credential: { ...credential, access: 'verified-key' }
				};
			},
			subjectKey: 'metaSubject',
			credentialsKey: 'metaCredentials',
			subjectColumn: user.metaSubject,
			credentialsColumn: user.metaCredentials
		}).routes;
		const values = new Map<string, string>();
		const cookies = {
			get: (name: string) => values.get(name),
			set: (name: string, value: string) => values.set(name, value),
			delete: (name: string) => values.delete(name)
		};
		const event = (operation: string) => {
			const url = new URL('http://localhost/api/auth/meta');
			return {
				request: new Request(url, {
					method: 'POST',
					headers: { Origin: url.origin, 'Content-Type': 'application/x-www-form-urlencoded' },
					body: new URLSearchParams({ operation })
				}),
				url,
				cookies,
				locals: { user: { id: 'owner' } },
				getClientAddress: () => '127.0.0.1'
			} as unknown as Parameters<typeof routes.POST>[0];
		};
		const started = await routes.POST(event('start'));
		assert.equal(started.status, 200);
		assert.equal((await started.json()).code, 'ABC-123');
		let ready = false;
		for (let attempt = 0; attempt < 10 && !ready; attempt++)
			ready = (await (await routes.GET(event('poll'))).json()).ready === true;
		assert.equal(ready, true);
		const finished = await routes.POST(event('finish'));
		assert.equal(finished.status, 200);
		assert.equal(identifications, 1);
		const account = await db
			.select({ subject: user.metaSubject, credentials: user.metaCredentials })
			.from(user)
			.get();
		assert.equal(account?.subject, 'meta:owner@example.com');
		assert.equal(JSON.parse(account?.credentials ?? '{}').access, 'verified-key');
	});

	test('Codex discovers Sol 6.1 per account and retains SDK capabilities and valid efforts', async () => {
		const access = (accountId: string) =>
			`header.${Buffer.from(
				JSON.stringify({
					sub: 'openai-owner',
					iss: 'https://auth.openai.com',
					exp: Math.floor(expires / 1000),
					'https://api.openai.com/auth': { chatgpt_account_id: accountId }
				})
			).toString('base64url')}.signature`;
		const saveCredential = (accountId: string) =>
			db
				.update(user)
				.set({
					codexSubject: 'openai-owner',
					codexCredentials: JSON.stringify({
						type: 'oauth',
						access: access(accountId),
						refresh: 'fake-refresh',
						expires
					})
				})
				.where(eq(user.id, 'owner'));
		await saveCredential('workspace-a');
		const models = await codexModels('owner');
		assert.deepEqual(
			models.map((model) => model.id),
			['gpt-6.1-sol']
		);
		const model = models[0];
		assert.ok(model);
		assert.equal(model.name, 'GPT-6.1 Sol');
		assert.deepEqual(model.efforts, ['low', 'medium', 'high', 'xhigh', 'max']);
		assert.equal(model.defaultEffort, 'medium');
		assert.equal(model.thinkingLevelMap?.off, null);
		assert.equal(model.thinkingLevelMap?.minimal, null);
		assert.equal(model.compat?.supportsMidConvoSystemMessages, true);
		assert.ok(model.inputLimits?.images?.resize);
		assert.equal(model.contextWindow, 272_000);
		assert.equal(model.maxTokens, 128_000);
		assert.equal(model.cost.input, 0);
		const request = codexRequests.at(-1);
		assert.ok(request);
		assert.equal(new URL(request.url).searchParams.get('client_version'), '0.159.2');
		assert.equal(new Headers(request.headers).get('ChatGPT-Account-Id'), 'workspace-a');
		assert.ok(request.key.includes('workspace-a'));
		await saveCredential('workspace-b');
		await codexModels('owner');
		assert.notEqual(codexRequests.at(-1)?.key, request.key);

		// Inspect the real SDK serialization and stop before any request reaches OpenAI.
		let captured: unknown;
		const response = await codexProvider
			.streamSimple(model, normalizeContext({ messages: [] }), {
				apiKey: access('workspace-a'),
				reasoning: 'max',
				transport: 'sse',
				onPayload: (payload) => {
					captured = payload;
					throw new Error('fixture stops before network');
				}
			})
			.result();
		assert.equal(response.stopReason, 'error');
		assert.match(response.errorMessage ?? '', /fixture stops before network/u);
		assert.equal((captured as { reasoning?: { effort?: string } }).reasoning?.effort, 'max');
	});

	test('Copilot exposes only enabled models and preserves the account endpoint', async () => {
		const credential: OAuthCredential = {
			type: 'oauth',
			access: 'tid=fake;proxy-ep=proxy.business.githubcopilot.com',
			refresh: 'fake-github-token',
			expires,
			availableModelIds: ['gpt-6-luna']
		};
		await db
			.update(user)
			.set({ copilotSubject: 'github:123', copilotCredentials: JSON.stringify(credential) });
		const models = await copilotModels('owner');
		assert.deepEqual(
			models.map((model) => model.id),
			['gpt-6-luna']
		);
		assert.equal(models[0]?.baseUrl, 'https://api.business.githubcopilot.com');
		assert.equal(
			(await copilotModelAuth('owner')).baseUrl,
			'https://api.business.githubcopilot.com'
		);
		await assert.rejects(
			loadAssistantModel('owner', 'copilot:gpt-6-astra'),
			/Choose an available model/u
		);
		const selected = await loadAssistantModel('owner', 'copilot:gpt-6-luna');
		assert.equal(selected.model.baseUrl, 'https://api.business.githubcopilot.com');
		assert.equal((await selected.requestAuth()).baseUrl, selected.model.baseUrl);
	});
}
