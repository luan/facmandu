import { randomBytes } from 'node:crypto';
import type { OAuthAuth, OAuthCredential, ThinkingLevel } from '@earendil-works/pi-ai';
import { error, json, type RequestHandler } from '@sveltejs/kit';
import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { AccountError, createInvitedAccount } from './accounts';
import * as auth from './auth';
import { db } from './db';
import { genID } from './db/ids';
import { user } from './db/schema';

export type ProviderId = 'codex' | 'meta' | 'copilot';

type SubjectKey = 'codexSubject' | 'metaSubject' | 'copilotSubject';
type CredentialsKey = 'codexCredentials' | 'metaCredentials' | 'copilotCredentials';

export type ProviderAuthConfig = {
	id: ProviderId;
	displayName: string;
	issuerName: string;
	oauth: OAuthAuth;
	// Answers interactive login prompts headlessly. Codex selects the device
	// flow; Copilot leaves the enterprise domain blank for github.com.
	answerPrompt: (prompt: { type: string }) => Promise<string>;
	// Verify the account and return the credential to store. Some identity
	// exchanges mint a new access key, so callers must retain that result.
	identify: (
		credential: OAuthCredential
	) =>
		| Promise<{ subject: string; credential: OAuthCredential }>
		| { subject: string; credential: OAuthCredential };
	subjectKey: SubjectKey;
	credentialsKey: CredentialsKey;
	subjectColumn: SubjectColumn;
	credentialsColumn: CredentialsColumn;
};

type SubjectColumn =
	| typeof user.codexSubject
	| typeof user.metaSubject
	| typeof user.copilotSubject;
type CredentialsColumn =
	| typeof user.codexCredentials
	| typeof user.metaCredentials
	| typeof user.copilotCredentials;

type ProviderPatch = Pick<
	typeof user.$inferInsert,
	| 'codexSubject'
	| 'codexCredentials'
	| 'metaSubject'
	| 'metaCredentials'
	| 'copilotSubject'
	| 'copilotCredentials'
>;

function patch(fields: Partial<ProviderPatch>): ProviderPatch {
	return fields as ProviderPatch;
}

type Pending = {
	userId: string | null;
	controller: AbortController;
	expiresAt: number;
	code?: string;
	url?: string;
	subject?: string;
	credential?: OAuthCredential;
	message?: string;
};

const credentialSchema = z
	.object({
		type: z.literal('oauth'),
		access: z.string(),
		refresh: z.string(),
		expires: z.number()
	})
	.passthrough();

export function createProviderAuth(config: ProviderAuthConfig) {
	const { id, displayName, issuerName, oauth, identify, answerPrompt } = config;
	const cookie = id === 'codex' ? 'codex-login' : `${id}-login`;
	const pending: Map<string, Pending> = import.meta.hot?.data[`provider-auth:${id}`] ?? new Map();
	if (import.meta.hot) import.meta.hot.data[`provider-auth:${id}`] = pending;

	function cancelLogin(loginId: string | undefined) {
		if (!loginId) return;
		pending.get(loginId)?.controller.abort();
		pending.delete(loginId);
	}

	async function beginLogin(userId: string | null) {
		for (const [loginId, entry] of pending) if (entry.expiresAt <= Date.now()) cancelLogin(loginId);
		if (pending.size >= 32) error(429, 'Too many sign-in attempts. Try again shortly.');
		const loginId = randomBytes(32).toString('base64url');
		const entry: Pending = {
			userId,
			controller: new AbortController(),
			expiresAt: Date.now() + 900_000
		};
		pending.set(loginId, entry);
		const expiry = setTimeout(() => cancelLogin(loginId), 900_000);
		expiry.unref();
		await new Promise<void>((resolve) => {
			const startTimeout = setTimeout(() => {
				entry.message = `${issuerName} did not respond. Try again.`;
				entry.controller.abort();
				resolve();
			}, 20_000);
			void oauth
				.login({
					signal: entry.controller.signal,
					prompt: (prompt) => answerPrompt(prompt),
					notify: (event) => {
						if (event.type === 'device_code') {
							entry.code = event.userCode;
							entry.url = event.verificationUri;
							clearTimeout(startTimeout);
							resolve();
						}
					}
				})
				.then(async (credential) => {
					const verified = await identify(credential);
					entry.subject = verified.subject;
					entry.credential = verified.credential;
				})
				.catch(() => {
					entry.message = `${displayName} sign-in failed or expired. Start again.`;
				})
				.finally(() => {
					clearTimeout(startTimeout);
					resolve();
				});
		});
		return { id: loginId, entry };
	}

	function pendingLogin(loginId: string | undefined, userId: string | null) {
		const entry = loginId && pending.get(loginId);
		if (!entry || entry.expiresAt <= Date.now() || entry.userId !== userId)
			error(400, `Start ${displayName} sign-in again`);
		return entry;
	}

	const refreshes = new Map<string, Promise<OAuthCredential>>();
	async function credential(userId: string): Promise<OAuthCredential> {
		const existing = refreshes.get(userId);
		if (existing !== undefined) return existing;
		const refresh = (async () => {
			const account = await db
				.select({
					credentials: config.credentialsColumn,
					subject: config.subjectColumn
				})
				.from(user)
				.where(eq(user.id, userId))
				.get();
			if (!account?.credentials) throw new Error(`Connect your ${displayName} account in settings`);
			let credential = credentialSchema.parse(JSON.parse(account.credentials));
			if (credential.expires <= Date.now() + 60_000) {
				const previous = credential;
				credential = credentialSchema.parse(
					await oauth.refresh(credential, AbortSignal.timeout(30_000))
				);
				// An unchanged refresh token retains the identity checked at sign-in.
				// Muse's identity check mints another key, so only recheck rotated tokens.
				if (credential.refresh !== previous.refresh) {
					const verified = await identify(credential);
					if (verified.subject !== account.subject)
						throw new Error(`${displayName} identity changed; connect again`);
					credential = credentialSchema.parse(verified.credential);
				}
				// Do not resurrect credentials after disconnect or overwrite a newer login.
				const changed = await db
					.update(user)
					.set(patch({ [config.credentialsKey]: JSON.stringify(credential) }))
					.where(and(eq(user.id, userId), eq(config.credentialsColumn, account.credentials)))
					.returning({ id: user.id });
				if (!changed.length) throw new Error(`${displayName} connection changed. Try again.`);
			}
			return credential;
		})();
		refreshes.set(userId, refresh);
		try {
			return await refresh;
		} finally {
			refreshes.delete(userId);
		}
	}

	async function accessToken(userId: string): Promise<string> {
		return (await credential(userId)).access;
	}

	const GET: RequestHandler = ({ cookies, locals }) => {
		if (!cookies.get(cookie))
			return json({ active: false }, { headers: { 'Cache-Control': 'no-store' } });
		const entry = pendingLogin(cookies.get(cookie), locals.user?.id ?? null);
		return json(
			{
				code: entry.code,
				url: entry.url,
				ready: Boolean(entry.credential),
				message: entry.message
			},
			{ headers: { 'Cache-Control': 'no-store' } }
		);
	};

	const POST: RequestHandler = async (event) => {
		auth.requireSameOrigin(event.request, event.url);
		const form = await auth.authenticationForm(event.request);
		const operation = form.get('operation');
		const current = event.cookies.get(cookie);
		if (operation === 'cancel') {
			cancelLogin(current);
			event.cookies.delete(cookie, { path: '/' });
			return json({ cancelled: true });
		}
		if (operation === 'start') {
			const attempt = auth.beginAuthentication(event.getClientAddress());
			if (!attempt.allowed) error(429, 'Too many sign-in attempts');
			try {
				cancelLogin(current);
				const { id: loginId, entry } = await beginLogin(event.locals.user?.id ?? null);
				event.cookies.set(cookie, loginId, {
					path: '/',
					httpOnly: true,
					sameSite: 'strict',
					secure: true,
					maxAge: 900
				});
				return json({ code: entry.code, url: entry.url, message: entry.message });
			} finally {
				attempt.release();
			}
		}
		if (operation !== 'finish') error(400, 'Unknown sign-in action');
		const entry = pendingLogin(current, event.locals.user?.id ?? null);
		if (!entry.credential || !entry.subject)
			error(409, entry.message ?? `Complete sign-in at ${issuerName} first`);
		// Consume before awaiting writes: one browser attempt can finalize only once.
		const credential = entry.credential;
		const subject = entry.subject;
		entry.credential = undefined;
		const credentials = JSON.stringify(credential);
		try {
			let account = await db
				.select({ id: user.id })
				.from(user)
				.where(eq(config.subjectColumn, subject))
				.get();
			if (event.locals.user) {
				if (account && account.id !== event.locals.user.id)
					error(409, `This ${displayName} account is connected to another user`);
				const changed = await db
					.update(user)
					.set(patch({ [config.subjectKey]: subject, [config.credentialsKey]: credentials }))
					.where(
						and(
							eq(user.id, event.locals.user.id),
							account ? eq(config.subjectColumn, subject) : isNull(config.subjectColumn)
						)
					)
					.returning({ id: user.id });
				if (!changed.length)
					error(409, `Disconnect your current ${displayName} account before switching`);
				return json({ connected: true });
			}
			if (!account) {
				const parsed = z
					.object({
						username: z
							.string()
							.min(3)
							.max(31)
							.regex(/^[a-z0-9_-]+$/),
						invite: z.string().min(1).max(100)
					})
					.safeParse(Object.fromEntries(form));
				if (!parsed.success) {
					entry.credential = credential;
					error(400, 'A username and invitation are required for a new account');
				}
				account = await createInvitedAccount(
					{
						id: genID('user'),
						username: parsed.data.username,
						passwordHash: `oauth:${randomBytes(32).toString('hex')}`,
						...patch({
							[config.subjectKey]: subject,
							[config.credentialsKey]: credentials
						})
					},
					parsed.data.invite
				);
			} else
				await db
					.update(user)
					.set(patch({ [config.credentialsKey]: credentials }))
					.where(and(eq(user.id, account.id), eq(config.subjectColumn, subject)));
			const token = auth.generateSessionToken();
			const session = await auth.createSession(token, account.id);
			auth.setSessionTokenCookie(event, token, session.expiresAt);
			return json({ connected: true });
		} catch (cause) {
			if (cause instanceof AccountError) {
				entry.credential = credential;
				error(400, cause.message);
			}
			throw cause;
		} finally {
			if (!entry.credential) {
				cancelLogin(current);
				event.cookies.delete(cookie, { path: '/' });
			}
		}
	};

	return { beginLogin, pendingLogin, cancelLogin, credential, accessToken, routes: { GET, POST } };
}

export type ProviderAuth = ReturnType<typeof createProviderAuth>;

const effortOrder: ThinkingLevel[] = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'];

// Static catalogs carry a thinkingLevelMap; expose only levels pi can send.
export function deriveEfforts(model: object): {
	efforts: ThinkingLevel[];
	defaultEffort: ThinkingLevel;
} {
	const thinkingLevelMap = (model as { thinkingLevelMap?: Record<string, string | null> })
		.thinkingLevelMap;
	const efforts = effortOrder.filter(
		(effort) => thinkingLevelMap?.[effort] !== undefined && thinkingLevelMap?.[effort] !== null
	);
	if (!efforts.length) return { efforts: ['medium'], defaultEffort: 'medium' };
	return {
		efforts,
		defaultEffort: efforts.includes('medium') ? 'medium' : (efforts[0] ?? 'medium')
	};
}
