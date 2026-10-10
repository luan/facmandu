import type { ModelAuth, Provider } from '@earendil-works/pi-ai';
import { builtinProviders } from '@earendil-works/pi-ai/providers/all';
import { eq } from 'drizzle-orm';
import { db } from './db';
import { providerKey, user } from './db/schema';

// These providers need endpoint, cloud identity, or account configuration.
// Add them when the connection form can collect those fields; never use host credentials.
const configuredProviders = new Set([
	'amazon-bedrock',
	'azure-openai-responses',
	'cloudflare-ai-gateway',
	'cloudflare-workers-ai',
	'google-vertex',
	'github-copilot'
]);
export const apiProviders: Provider[] = builtinProviders().filter(
	(provider) =>
		provider.auth.apiKey?.login &&
		provider.getModels().length &&
		!configuredProviders.has(provider.id)
);

export async function apiProviderAuth(provider: Provider, key: string): Promise<ModelAuth> {
	const result = await provider.auth.apiKey?.resolve({
		credential: { type: 'api_key', key },
		ctx: { env: async () => undefined, fileExists: async () => false },
		signal: new AbortController().signal
	});
	if (!result) throw new Error(`${provider.name} needs additional connection settings`);
	return result.auth;
}

export async function accountProviderKeys(userId: string): Promise<Map<string, string>> {
	const rows = await db.select().from(providerKey).where(eq(providerKey.userId, userId));
	const account = await db
		.select({ key: user.openaiApiKey })
		.from(user)
		.where(eq(user.id, userId))
		.get();
	const keys = new Map(rows.map((row) => [row.providerId, row.key]));
	// OpenAI also powers routing and recommendations; keep one saved credential.
	if (account?.key) keys.set('openai', account.key);
	return keys;
}

export async function accountProviderKey(userId: string, providerId: string): Promise<string> {
	const key = (await accountProviderKeys(userId)).get(providerId);
	if (!key) throw new Error('Provider disconnected. Add it again in Account settings');
	return key;
}
