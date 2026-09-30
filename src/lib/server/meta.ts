import type { Model, OAuthCredential, ThinkingLevel } from '@earendil-works/pi-ai';
import { metaProvider as createMetaProvider } from '@earendil-works/pi-ai/providers/meta';
import { META_MODELS } from '@earendil-works/pi-ai/providers/meta.models';
import { z } from 'zod';
import { user } from './db/schema';
import { createProviderAuth, deriveEfforts } from './provider-auth';

export const metaProvider = createMetaProvider();

const oauth = (() => {
	const value = metaProvider.auth.oauth;
	if (!value) throw new Error('Meta OAuth provider unavailable');
	return value;
})();

// Meta issues opaque identity tokens, so there is no JWT sub to bind. The
// key-mint endpoint reports the account email for a valid token and returns
// a new API key. Keep that key in case minting invalidates the previous one.
// The identity token only comes from Meta's HTTPS exchange.
export async function metaIdentity(
	credential: OAuthCredential
): Promise<{ subject: string; credential: OAuthCredential }> {
	const response = await fetch('https://api.meta.ai/muse-code/key', {
		method: 'POST',
		headers: {
			Accept: 'application/json',
			Authorization: `Bearer ${credential.refresh}`,
			'Content-Type': 'application/json',
			'x-api-version': '1.0.0'
		},
		body: '{}',
		signal: AbortSignal.timeout(15_000)
	});
	if (!response.ok) throw new Error('Could not verify Meta identity');
	const result = z
		.object({ user_email: z.string().email(), api_key: z.string().min(1) })
		.parse(await response.json());
	return {
		subject: `meta:${result.user_email.toLowerCase()}`,
		credential: { ...credential, access: result.api_key }
	};
}

const auth = createProviderAuth({
	id: 'meta',
	displayName: 'Muse',
	issuerName: 'Meta',
	oauth,
	answerPrompt: (prompt) => {
		if (prompt.type === 'select') return Promise.resolve('device_code');
		return Promise.reject(new Error('Unsupported sign-in prompt'));
	},
	identify: metaIdentity,
	subjectKey: 'metaSubject',
	credentialsKey: 'metaCredentials',
	subjectColumn: user.metaSubject,
	credentialsColumn: user.metaCredentials
});

export const metaAccessToken = auth.accessToken;
export const metaAuthRoutes = auth.routes;

export type MetaModel = Model<'openai-responses'> & {
	efforts: ThinkingLevel[];
	defaultEffort: ThinkingLevel;
};

export function metaModels(): MetaModel[] {
	return Object.values(META_MODELS).map((model) => ({ ...model, ...deriveEfforts(model) }));
}
