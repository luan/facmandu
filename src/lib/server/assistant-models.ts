import type { Api, Model, ModelAuth, Provider, ThinkingLevel } from '@earendil-works/pi-ai';
import { eq } from 'drizzle-orm';
import {
	accountProviderKey,
	accountProviderKeys,
	apiProviderAuth,
	apiProviders
} from './assistant-providers';
import { codexAccessToken, codexModels, codexProvider } from './codex';
import { copilotAccessToken, copilotModelAuth, copilotModels, copilotProvider } from './copilot';
import { db } from './db';
import { user } from './db/schema';
import { metaAccessToken, metaModels, metaProvider } from './meta';
import { deriveEfforts } from './provider-auth';

export type AssistantProviderId = 'codex' | 'meta' | 'copilot' | `api:${string}`;

export function assistantProviderName(
	context: { userId: string; chatId?: string } & (
		| { serverId: string; listId?: never }
		| { listId: string; serverId?: never }
	)
) {
	const target = `${context.userId}-${context.serverId ? `server-${context.serverId}` : context.listId}`;
	return `codex-${context.chatId && context.chatId !== `${target}-chat` ? context.chatId : target}`;
}

export type AssistantModel = {
	// Codex keeps bare catalog ids so stored turns still resolve. Meta and
	// Copilot ids are namespaced to avoid cross-provider collisions.
	id: string;
	name: string;
	efforts: ThinkingLevel[];
	defaultEffort: ThinkingLevel;
	effortLabels?: Partial<Record<ThinkingLevel, string>>;
	provider: AssistantProviderId;
};

export type LoadedAssistantModel = {
	entry: AssistantModel;
	provider: Provider;
	model: Model<Api>;
	accessToken: () => Promise<string>;
	requestAuth: () => Promise<ModelAuth>;
	// Only the Codex transport needs the single-tool-call shaping.
	codexTransport: boolean;
};

type CatalogModel = {
	id: string;
	name: string;
	efforts: ThinkingLevel[];
	defaultEffort: ThinkingLevel;
	effortLabels?: Partial<Record<ThinkingLevel, string>>;
};

type Source = {
	provider: AssistantProviderId;
	label: string;
	namespaced: boolean;
	models: (userId: string) => Promise<CatalogModel[]>;
	providerInstance: Provider;
	accessToken: (userId: string) => Promise<string>;
	requestAuth?: (userId: string) => Promise<ModelAuth>;
	codexTransport: boolean;
};

const sources: (Source & { provider: keyof ConnectionSubjects })[] = [
	{
		provider: 'codex',
		label: 'Codex',
		namespaced: false,
		models: (userId) => codexModels(userId),
		providerInstance: codexProvider as unknown as Provider,
		accessToken: codexAccessToken,
		codexTransport: true
	},
	{
		provider: 'meta',
		label: 'Muse',
		namespaced: true,
		models: () => Promise.resolve(metaModels()),
		providerInstance: metaProvider as unknown as Provider,
		accessToken: metaAccessToken,
		codexTransport: false
	},
	{
		provider: 'copilot',
		label: 'Copilot',
		namespaced: true,
		models: copilotModels,
		providerInstance: copilotProvider as unknown as Provider,
		accessToken: copilotAccessToken,
		requestAuth: copilotModelAuth,
		codexTransport: false
	}
];

type ConnectionSubjects = Record<'codex' | 'meta' | 'copilot', string | null>;

async function connectionSubjects(userId: string): Promise<ConnectionSubjects | undefined> {
	const account = await db
		.select({
			codex: user.codexSubject,
			meta: user.metaSubject,
			copilot: user.copilotSubject
		})
		.from(user)
		.where(eq(user.id, userId))
		.get();
	return account ?? undefined;
}

async function connectedSources(userId: string): Promise<Source[]> {
	const [account, keys] = await Promise.all([
		connectionSubjects(userId),
		accountProviderKeys(userId)
	]);
	const connected: Source[] = sources.filter((source) => account?.[source.provider]);
	for (const provider of apiProviders) {
		const key = keys.get(provider.id);
		if (!key) continue;
		connected.push({
			provider: `api:${provider.id}`,
			label: provider.name,
			namespaced: true,
			models: async () =>
				provider.getModels().map((model) => ({ ...model, ...deriveEfforts(model) })),
			providerInstance: provider,
			accessToken: () => accountProviderKey(userId, provider.id),
			requestAuth: async () =>
				apiProviderAuth(provider, await accountProviderKey(userId, provider.id)),
			codexTransport: false
		});
	}
	return connected;
}

export async function assistantModelCatalog(userId: string): Promise<AssistantModel[]> {
	const connected = await connectedSources(userId);
	if (!connected.length) throw new Error('Add a provider in Account settings to use the assistant');
	const catalog: AssistantModel[] = [];
	let firstError: unknown = null;
	for (const source of connected) {
		try {
			const models = await source.models(userId);
			for (const model of models)
				catalog.push({
					id: source.namespaced ? `${source.provider}:${model.id}` : model.id,
					name: source.namespaced ? `${source.label} · ${model.name}` : model.name,
					efforts: model.efforts,
					defaultEffort: model.defaultEffort,
					effortLabels: model.effortLabels,
					provider: source.provider
				});
		} catch (cause) {
			firstError ??= cause;
		}
	}
	if (!catalog.length)
		throw new Error(
			firstError instanceof Error ? firstError.message : 'No assistant models are available'
		);
	return catalog;
}

export async function loadAssistantModel(
	userId: string,
	modelId: string | undefined
): Promise<LoadedAssistantModel> {
	const connected = await connectedSources(userId);
	if (!connected.length) throw new Error('Add a provider in Account settings to use the assistant');
	let firstError: unknown;
	// A selected model must not wait on unrelated providers or fetch its catalog twice.
	for (const source of connected) {
		if (
			modelId &&
			(source.namespaced ? !modelId.startsWith(`${source.provider}:`) : modelId.includes(':'))
		)
			continue;
		let models: CatalogModel[];
		try {
			models = await source.models(userId);
		} catch (cause) {
			if (modelId) throw cause;
			firstError ??= cause;
			continue;
		}
		const bareId =
			modelId && (source.namespaced ? modelId.slice(source.provider.length + 1) : modelId);
		const model = bareId ? models.find((item) => item.id === bareId) : models[0];
		if (!model) continue;
		return {
			entry: {
				id: source.namespaced ? `${source.provider}:${model.id}` : model.id,
				name: source.namespaced ? `${source.label} · ${model.name}` : model.name,
				efforts: model.efforts,
				defaultEffort: model.defaultEffort,
				effortLabels: model.effortLabels,
				provider: source.provider
			},
			provider: source.providerInstance,
			model: model as unknown as Model<Api>,
			accessToken: () => source.accessToken(userId),
			requestAuth: () =>
				source.requestAuth
					? source.requestAuth(userId)
					: source.accessToken(userId).then((apiKey) => ({ apiKey })),
			codexTransport: source.codexTransport
		};
	}
	throw new Error(
		modelId
			? 'Choose an available model in the assistant'
			: firstError instanceof Error
				? firstError.message
				: 'No assistant models are available'
	);
}

export async function assistantConnected(userId: string): Promise<boolean> {
	return (await connectedSources(userId)).length > 0;
}
