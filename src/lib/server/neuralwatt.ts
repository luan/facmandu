import { createProvider, envApiKeyAuth } from '@earendil-works/pi-ai';
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy';

const provider = createProvider({
	id: 'neuralwatt',
	name: 'NeuralWatt',
	baseUrl: 'https://api.neuralwatt.com/v1',
	auth: { apiKey: envApiKeyAuth('NeuralWatt API key', []) },
	api: openAICompletionsApi(),
	// Start with the requested model; add others from the live catalog when needed.
	// https://api.neuralwatt.com/v1/models
	models: [
		{
			id: 'deepseek-v4.1-flash',
			name: 'DeepSeek V4.1 Flash',
			provider: 'neuralwatt',
			api: 'openai-completions',
			baseUrl: 'https://api.neuralwatt.com/v1',
			input: ['text', 'image'],
			reasoning: true,
			thinkingLevelMap: { low: 'low', high: 'high', xhigh: 'xhigh', max: 'max' },
			contextWindow: 1048560,
			maxTokens: 393216,
			cost: { input: 0.15, output: 0.6, cacheRead: 0.015, cacheWrite: 0 },
			compat: {
				supportsDeveloperRole: false,
				supportsStore: false,
				supportsReasoningEffort: true,
				maxTokensField: 'max_tokens'
			}
		}
	]
});

// Bound each deliberation, not the whole agent run. Leave room for native
// blueprint arguments and answers after the serving layer ends reasoning.
export const neuralwattProvider = {
	...provider,
	streamSimple: ((model, context, options) =>
		provider.streamSimple(model, context, {
			...options,
			maxTokens: options?.maxTokens ?? 65_536,
			onPayload: async (payload, selected) => {
				const budgets = {
					minimal: 1024,
					low: 2048,
					medium: 4096,
					high: 8192,
					xhigh: 16_384,
					max: 32_768
				};
				const body =
					payload && typeof payload === 'object' && options?.reasoning
						? { ...payload, thinking_token_budget: budgets[options.reasoning] }
						: payload;
				return (await options?.onPayload?.(body, selected)) ?? body;
			}
		})) satisfies typeof provider.streamSimple
};
