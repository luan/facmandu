import { error, fail } from '@sveltejs/kit';
import { and, eq, isNotNull, ne, or, sql } from 'drizzle-orm';
import { authenticationForm } from '$lib/server/auth';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import type { Actions, PageServerLoad } from './$types';
import { schema } from './schema';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) error(401, 'Sign in to manage your account');
	const account = await db
		.select({ username: table.user.factorioUsername, connected: table.user.factorioTokenUpdatedAt })
		.from(table.user)
		.where(eq(table.user.id, locals.user.id))
		.get();
	const preferences = await db
		.select({
			key: table.user.typesafeApiKey,
			codexSubject: table.user.codexSubject,
			metaSubject: table.user.metaSubject,
			copilotSubject: table.user.copilotSubject
		})
		.from(table.user)
		.where(eq(table.user.id, locals.user.id))
		.get();
	return {
		account,
		typesafeConnected: Boolean(preferences?.key),
		codexConnected: Boolean(preferences?.codexSubject),
		metaConnected: Boolean(preferences?.metaSubject),
		copilotConnected: Boolean(preferences?.copilotSubject)
	};
};

const providerKeys = {
	codex: { subject: 'codexSubject', credentials: 'codexCredentials' },
	meta: { subject: 'metaSubject', credentials: 'metaCredentials' },
	copilot: { subject: 'copilotSubject', credentials: 'copilotCredentials' }
} as const;

type ProviderPatch = Pick<
	typeof table.user.$inferInsert,
	| 'codexSubject'
	| 'codexCredentials'
	| 'metaSubject'
	| 'metaCredentials'
	| 'copilotSubject'
	| 'copilotCredentials'
>;

function disconnectProvider(provider: keyof typeof providerKeys, displayName: string) {
	return async ({ request, locals }: { request: Request; locals: App.Locals }) => {
		if (!locals.user) error(401, 'Sign in to manage your account');
		const form = await authenticationForm(request);
		if (form.get('disconnect') === 'true') {
			// Evaluate remaining sign-in methods in the same statement that removes one.
			const remaining = (Object.keys(providerKeys) as (keyof typeof providerKeys)[])
				.filter((name) => name !== provider)
				.map((name) => {
					const subject = table.user[providerKeys[name].subject];
					return and(isNotNull(subject), ne(subject, ''));
				});
			const patch = {
				[providerKeys[provider].subject]: null,
				[providerKeys[provider].credentials]: null
			} as unknown as ProviderPatch;
			const disconnected = await db
				.update(table.user)
				.set(patch)
				.where(
					and(
						eq(table.user.id, locals.user.id),
						or(sql`substr(${table.user.passwordHash}, 1, 7) = '$argon2'`, ...remaining)
					)
				)
				.returning({ id: table.user.id })
				.get();
			if (!disconnected)
				return fail(400, { success: false, message: `${displayName} is your only sign-in method` });
			return { success: true, message: `${displayName} disconnected` };
		}
		return fail(400, { success: false, message: 'Choose a model in the feature you want to use' });
	};
}

export const actions: Actions = {
	codex: disconnectProvider('codex', 'Codex'),
	meta: disconnectProvider('meta', 'Muse'),
	copilot: disconnectProvider('copilot', 'Copilot'),
	typesafe: async ({ request, locals }) => {
		if (!locals.user) error(401, 'Sign in to manage your account');
		const form = await authenticationForm(request);
		const key = String(form.get('key') ?? '').trim();
		if (form.get('remove') !== 'true' && (!key || key.length > 4096 || /\s/.test(key)))
			return fail(400, { success: false, message: 'Enter a valid TypeSafe API key' });
		await db
			.update(table.user)
			.set({ typesafeApiKey: form.get('remove') === 'true' ? null : key })
			.where(eq(table.user.id, locals.user.id));
		return {
			success: true,
			message: form.get('remove') === 'true' ? 'TypeSafe key removed' : 'TypeSafe key saved'
		};
	},
	updateFactorioCredentials: async ({ request, locals }) => {
		if (!locals.user) error(401, 'Sign in to manage your account');
		const parsed = schema.safeParse(Object.fromEntries(await authenticationForm(request)));
		if (!parsed.success)
			return fail(400, { message: parsed.error.issues[0]?.message ?? 'Invalid settings' });
		const { factorioUsername, factorioToken } = parsed.data;
		await db
			.update(table.user)
			.set({ factorioUsername, factorioToken, factorioTokenUpdatedAt: new Date() })
			.where(eq(table.user.id, locals.user.id));
		return { success: true, message: 'Factorio token saved' };
	}
};
