// @ts-expect-error Bun supplies this built-in at runtime; the project uses Node type declarations.
import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { normalizeContext, Type } from '@earendil-works/pi-ai';
import { neuralwattProvider } from '../src/lib/server/neuralwatt';

test('NeuralWatt uses explicit account keys and serializes reasoning and tools', async () => {
	const auth = neuralwattProvider.auth.apiKey;
	assert.ok(auth);
	const ctx = { env: async () => 'host-secret', fileExists: async () => false };
	const signal = new AbortController().signal;
	assert.equal(await auth.resolve({ ctx, signal }), undefined);
	const saved = await auth.resolve({
		credential: { type: 'api_key', key: 'account-key' },
		ctx,
		signal
	});
	assert.equal(saved?.auth.apiKey, 'account-key');
	const model = neuralwattProvider.getModels()[0];
	assert.ok(model);
	assert.equal(model.baseUrl, 'https://api.neuralwatt.com/v1');
	let captured: unknown;
	const response = await neuralwattProvider
		.streamSimple(
			model,
			normalizeContext({
				systemPrompt: 'Inspect the factory.',
				messages: [{ role: 'user', content: 'Find plastic.', timestamp: 0 }],
				tools: [
					{
						name: 'inspect',
						description: 'Inspect an entity',
						parameters: Type.Object({ x: Type.Number() })
					}
				]
			}),
			{
				apiKey: 'account-key',
				reasoning: 'low',
				maxTokens: 393216,
				onPayload: (payload) => {
					captured = payload;
					throw new Error('fixture stops before network');
				}
			}
		)
		.result();
	assert.match(response.errorMessage ?? '', /fixture stops before network/u);
	const payload = captured as {
		model: string;
		reasoning_effort: string;
		thinking_token_budget: number;
		max_tokens: number;
		messages: { role: string }[];
		tools: { function: { name: string } }[];
	};
	assert.equal(payload.model, 'deepseek-v4.1-flash');
	assert.equal(payload.reasoning_effort, 'low');
	assert.equal(payload.thinking_token_budget, undefined);
	assert.equal(payload.max_tokens, 65_536);
	assert.equal(payload.messages[0]?.role, 'system');
	assert.equal(payload.tools[0]?.function.name, 'inspect');
});
