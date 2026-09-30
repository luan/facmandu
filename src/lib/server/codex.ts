import type { Model, OAuthCredential, ThinkingLevel } from '@earendil-works/pi-ai';
import { openaiCodexProvider } from '@earendil-works/pi-ai/providers/openai-codex';
import { z } from 'zod';
import { user } from './db/schema';
import { cachedPortalRequest } from './portal-cache';
import { createProviderAuth } from './provider-auth';

export const codexProvider = openaiCodexProvider();
const effortValues = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const;
const effortSchema = z.enum(effortValues);
export type CodexModel = Model<'openai-codex-responses'> & {
	efforts: ThinkingLevel[];
	defaultEffort: ThinkingLevel;
};
const modelCatalogSchema = z.object({
	models: z
		.array(
			z.object({
				slug: z.string().min(1),
				display_name: z.string(),
				visibility: z.string(),
				priority: z.number().default(100),
				supported_reasoning_levels: z.array(z.object({ effort: z.string() })),
				default_reasoning_level: z.string(),
				context_window: z.number().positive(),
				input_modalities: z.array(z.enum(['text', 'image'])).default(['text', 'image'])
			})
		)
		.min(1)
});
export async function codexModels(userId: string): Promise<CodexModel[]> {
	const access = await codexAccessToken(userId);
	const subject = codexIdentity({ type: 'oauth', access, refresh: '', expires: 0 });
	const claims = z
		.object({ 'https://api.openai.com/auth': z.object({ chatgpt_account_id: z.string() }) })
		.parse(JSON.parse(Buffer.from(access.split('.')[1] ?? '', 'base64url').toString('utf8')));
	const accountId = claims['https://api.openai.com/auth'].chatgpt_account_id;
	// Match Codex's catalog protocol; cache by individual and workspace, never across accounts.
	const { data } = await cachedPortalRequest(
		`codex-models:v3:${userId}:${subject}:${accountId}`,
		'https://chatgpt.com/backend-api/codex/models?client_version=0.159.2',
		modelCatalogSchema,
		{ maxAgeMs: 3_600_000 },
		{ headers: { Authorization: `Bearer ${access}`, 'ChatGPT-Account-Id': accountId } }
	);
	if (!data) throw new Error('Codex model list unavailable');
	const sdkModels = new Map(codexProvider.getModels().map((model) => [model.id, model]));
	return data.models
		.filter((model) => model.visibility === 'list')
		.sort((a, b) => a.priority - b.priority)
		.flatMap((model) => {
			// Pi supports up to max; expose only efforts this transport can actually send.
			const efforts = model.supported_reasoning_levels.flatMap((item) => {
				const parsed = effortSchema.safeParse(item.effort);
				return parsed.success ? [parsed.data] : [];
			});
			// Do not offer a model when its catalog has no effort this transport supports.
			if (!efforts.length) return [];
			const known = sdkModels.get(model.slug);
			const preferred = effortSchema.safeParse(model.default_reasoning_level);
			const defaultEffort =
				preferred.success && efforts.includes(preferred.data)
					? preferred.data
					: (efforts[0] ?? 'medium');
			return [
				{
					// Keep protocol capabilities and image limits from the current SDK while
					// account availability, priorities and reasoning levels stay catalog-driven.
					...known,
					id: model.slug,
					name: model.display_name.replace(/^GPT-(\d+(?:\.\d+)?)-/, 'GPT-$1 '),
					api: 'openai-codex-responses',
					provider: codexProvider.id,
					baseUrl: codexProvider.baseUrl ?? 'https://chatgpt.com/backend-api',
					reasoning: true,
					efforts,
					defaultEffort,
					thinkingLevelMap: {
						off: null,
						...Object.fromEntries(
							effortValues.map((effort) => [effort, efforts.includes(effort) ? effort : null])
						)
					},
					input: model.input_modalities,
					contextWindow: model.context_window,
					maxTokens: Math.min(known?.maxTokens ?? 128_000, model.context_window),
					// Codex subscription requests have no API-token price in this catalog.
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
				}
			];
		});
}
const oauth = (() => {
	const value = codexProvider.auth.oauth;
	if (!value) throw new Error('Codex OAuth provider unavailable');
	return value;
})();

// Credentials only come from the provider's HTTPS token exchange, never from browser input.
export function codexIdentity(credential: OAuthCredential) {
	const part = credential.access.split('.')[1];
	const claims = z
		.object({ sub: z.string().min(1), iss: z.literal('https://auth.openai.com'), exp: z.number() })
		.parse(JSON.parse(Buffer.from(part ?? '', 'base64url').toString('utf8')));
	if (claims.exp * 1000 <= Date.now()) throw new Error('Expired Codex identity');
	return claims.sub;
}

const auth = createProviderAuth({
	id: 'codex',
	displayName: 'Codex',
	issuerName: 'OpenAI',
	oauth,
	answerPrompt: (prompt) => {
		if (prompt.type === 'select') return Promise.resolve('device_code');
		return Promise.reject(new Error('Unsupported sign-in prompt'));
	},
	identify: (credential) => ({ subject: codexIdentity(credential), credential }),
	subjectKey: 'codexSubject',
	credentialsKey: 'codexCredentials',
	subjectColumn: user.codexSubject,
	credentialsColumn: user.codexCredentials
});

export const codexAccessToken = auth.accessToken;
export const codexAuthRoutes = auth.routes;
