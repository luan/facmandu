import type { Api, Model, ModelAuth, Provider, ThinkingLevel } from '@earendil-works/pi-ai';
import { and, eq, isNotNull, or } from 'drizzle-orm';
import { codexAccessToken, codexModels, codexProvider } from './codex';
import { copilotAccessToken, copilotModelAuth, copilotModels, copilotProvider } from './copilot';
import { db } from './db';
import { user } from './db/schema';
import { metaAccessToken, metaModels, metaProvider } from './meta';

export type AssistantProviderId = 'codex' | 'meta' | 'copilot';

export type AssistantModel = {
	// Codex keeps bare catalog ids so stored turns still resolve. Meta and
	// Copilot ids are namespaced to avoid cross-provider collisions.
	id: string;
	name: string;
	efforts: ThinkingLevel[];
	defaultEffort: ThinkingLevel;
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

const sources: Source[] = [
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

type ConnectionSubjects = Record<AssistantProviderId, string | null>;

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

export async function assistantModelCatalog(userId: string): Promise<AssistantModel[]> {
	const account = await connectionSubjects(userId);
	if (!account || (!account.codex && !account.meta && !account.copilot))
		throw new Error('Connect a Codex, Muse, or Copilot account in Settings to use the assistant');
	const catalog: AssistantModel[] = [];
	let firstError: unknown = null;
	for (const source of sources) {
		if (!account[source.provider]) continue;
		try {
			const models = await source.models(userId);
			for (const model of models)
				catalog.push({
					id: source.namespaced ? `${source.provider}:${model.id}` : model.id,
					name: source.namespaced ? `${source.label} · ${model.name}` : model.name,
					efforts: model.efforts,
					defaultEffort: model.defaultEffort,
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
	const catalog = await assistantModelCatalog(userId);
	const entry = modelId ? catalog.find((model) => model.id === modelId) : catalog[0];
	if (!entry) throw new Error('Choose an available model in the assistant');
	const source = sources.find((item) => item.provider === entry.provider);
	if (!source) throw new Error('Choose an available model in the assistant');
	const bareId = source.namespaced ? entry.id.slice(source.provider.length + 1) : entry.id;
	const model = (await source.models(userId)).find((item) => item.id === bareId);
	if (!model) throw new Error('Choose an available model in the assistant');
	return {
		entry,
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

export async function assistantConnected(userId: string): Promise<boolean> {
	const account = await db
		.select({ id: user.id })
		.from(user)
		.where(
			and(
				eq(user.id, userId),
				or(
					isNotNull(user.codexSubject),
					isNotNull(user.metaSubject),
					isNotNull(user.copilotSubject)
				)
			)
		)
		.get();
	return Boolean(account);
}
