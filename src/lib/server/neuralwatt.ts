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
			// Native factory-image QA on this route exhausted reasoning without an
			// answer. Enable vision after that same image query returns usable output.
			input: ['text'],
			reasoning: true,
			thinkingLevelMap: { minimal: 'none', low: 'low', high: 'high', xhigh: 'xhigh', max: 'max' },
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

// Bound one model call rather than the whole agent response. Truncated calls
// continue through answer recovery. This route's forced thinking budget produced
// degenerate output in native QA; reconsider it only after that regression passes.
export const neuralwattProvider = {
	...provider,
	streamSimple: ((model, context, options) =>
		provider.streamSimple(model, context, {
			...options,
			maxTokens: Math.min(options?.maxTokens ?? 65_536, 65_536)
		})) satisfies typeof provider.streamSimple
};
