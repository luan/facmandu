import type { Model, ModelAuth, OAuthCredential, ThinkingLevel } from '@earendil-works/pi-ai';
import { githubCopilotProvider as createCopilotProvider } from '@earendil-works/pi-ai/providers/github-copilot';
import { GITHUB_COPILOT_MODELS } from '@earendil-works/pi-ai/providers/github-copilot.models';
import { z } from 'zod';
import { user } from './db/schema';
import { createProviderAuth, deriveEfforts } from './provider-auth';

export const copilotProvider = createCopilotProvider();

const oauth = (() => {
	const value = copilotProvider.auth.oauth;
	if (!value) throw new Error('GitHub Copilot OAuth provider unavailable');
	return value;
})();

const githubUserSchema = z.object({ id: z.number().int().positive() });

// The refresh token is a GitHub user token from the device flow. The numeric
// user id is stable across renames, unlike the login name.
export async function copilotIdentity(credential: OAuthCredential): Promise<string> {
	const response = await fetch('https://api.github.com/user', {
		headers: {
			Accept: 'application/vnd.github+json',
			Authorization: `Bearer ${credential.refresh}`,
			'User-Agent': 'facmandu'
		},
		signal: AbortSignal.timeout(15_000)
	});
	if (!response.ok) throw new Error('Could not verify GitHub identity');
	const id = githubUserSchema.parse(await response.json()).id;
	return `github:${id}`;
}

const auth = createProviderAuth({
	id: 'copilot',
	displayName: 'Copilot',
	issuerName: 'GitHub',
	oauth,
	// Enterprise hosts are not supported; blank selects github.com.
	answerPrompt: (prompt) => {
		if (prompt.type === 'text') return Promise.resolve('');
		if (prompt.type === 'select') return Promise.resolve('device_code');
		return Promise.reject(new Error('Unsupported sign-in prompt'));
	},
	identify: async (credential) => ({ subject: await copilotIdentity(credential), credential }),
	subjectKey: 'copilotSubject',
	credentialsKey: 'copilotCredentials',
	subjectColumn: user.copilotSubject,
	credentialsColumn: user.copilotCredentials
});

export const copilotAccessToken = auth.accessToken;
export const copilotAuthRoutes = auth.routes;

export async function copilotModelAuth(userId: string): Promise<ModelAuth> {
	return oauth.toAuth(await auth.credential(userId));
}

export type CopilotModel = Model<
	'anthropic-messages' | 'openai-completions' | 'openai-responses'
> & {
	efforts: ThinkingLevel[];
	defaultEffort: ThinkingLevel;
};

export async function copilotModels(userId: string): Promise<CopilotModel[]> {
	const credential = await auth.credential(userId);
	const requestAuth = await oauth.toAuth(credential);
	const catalog = Object.values(GITHUB_COPILOT_MODELS);
	const available = copilotProvider.filterModels?.(catalog, credential) ?? catalog;
	return available.map((model) => ({
		...model,
		baseUrl: requestAuth.baseUrl ?? model.baseUrl,
		...deriveEfforts(model)
	}));
}
