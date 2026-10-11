import { createProvider, envApiKeyAuth } from '@earendil-works/pi-ai';
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy';

export const neuralwattProvider = createProvider({
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
