import { createHash, randomBytes } from 'node:crypto';
import { error, type RequestEvent, redirect } from '@sveltejs/kit';
import { and, eq, gt, lt } from 'drizzle-orm';
import { z } from 'zod';
import { env } from '$env/dynamic/private';
import { generateSessionToken, requireSameOrigin, setSessionTokenCookie } from './auth';
import { db } from './db';
import { dropboxAccount, dropboxLogin, session } from './db/schema';
import { ServerError, updateServerConfig } from './server-files';
import { requireServer } from './servers';

const cookieName = 'dropbox-link';
const scopes = 'account_info.read files.metadata.read files.content.read files.content.write';
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const tokenSchema = z.object({
	access_token: z.string().min(1),
	refresh_token: z.string().min(1).optional(),
	account_id: z.string().optional(),
	scope: z.string().optional()
});
export const dropboxConfigured = () => !!env.DROPBOX_APP_KEY;
function callbackUrl(event: RequestEvent) {
	return new URL('/api/dropbox/callback', env.ORIGIN || event.url.origin).href;
}
async function exchangeToken(fields: Record<string, string>) {
	if (!env.DROPBOX_APP_KEY) throw new ServerError(503, 'Dropbox is not configured');
	const response = await fetch('https://api.dropboxapi.com/oauth2/token', {
		method: 'POST',
		body: new URLSearchParams({ client_id: env.DROPBOX_APP_KEY, ...fields }),
		signal: AbortSignal.timeout(30_000)
	});
	if (!response.ok)
		throw new ServerError(
			response.status === 400 || response.status === 401 ? 401 : 502,
			'Dropbox authorization failed. Reconnect Dropbox and try again.'
		);
	return tokenSchema.parse(await response.json());
}
export async function beginDropbox(event: RequestEvent): Promise<never> {
	requireSameOrigin(event.request, event.url);
	if (!event.locals.user || !event.locals.session) error(401, 'Sign in first');
	const server = await requireServer(
		event.locals.user.id,
		event.url.searchParams.get('serverId') || ''
	);
	if (!dropboxConfigured()) error(503, 'Dropbox is not configured');
	const state = randomBytes(32).toString('base64url');
	const verifier = randomBytes(32).toString('base64url');
	await db.delete(dropboxLogin).where(lt(dropboxLogin.expiresAt, Date.now()));
	await db.delete(dropboxLogin).where(eq(dropboxLogin.userId, event.locals.user.id));
	await db.insert(dropboxLogin).values({
		id: digest(state),
		userId: event.locals.user.id,
		sessionId: event.locals.session.id,
		serverId: server.id,
		verifier,
		expiresAt: Date.now() + 600_000
	});
	// The normal login cookie remains Strict; only this short-lived OAuth nonce is Lax.
	event.cookies.set(cookieName, state, {
		path: '/api/dropbox',
		secure: true,
		httpOnly: true,
		sameSite: 'lax',
		maxAge: 600
	});
	const url = new URL('https://www.dropbox.com/oauth2/authorize');
	url.search = new URLSearchParams({
		client_id: env.DROPBOX_APP_KEY || '',
		redirect_uri: callbackUrl(event),
		response_type: 'code',
		token_access_type: 'offline',
		scope: scopes,
		state,
		code_challenge_method: 'S256',
		code_challenge: createHash('sha256').update(verifier).digest('base64url')
	}).toString();
	redirect(303, url.href);
}
export async function finishDropbox(event: RequestEvent): Promise<Response> {
	const state = event.url.searchParams.get('state');
	if (!state || state !== event.cookies.get(cookieName))
		error(400, 'Dropbox sign-in expired. Start again from Saves.');
	event.cookies.delete(cookieName, { path: '/api/dropbox' });
	const login = await db
		.update(dropboxLogin)
		.set({ used: true })
		.where(
			and(
				eq(dropboxLogin.id, digest(state)),
				eq(dropboxLogin.used, false),
				gt(dropboxLogin.expiresAt, Date.now())
			)
		)
		.returning()
		.get();
	if (!login) error(400, 'Dropbox sign-in expired. Start again from Saves.');
	const activeSession = await db
		.select({ id: session.id })
		.from(session)
		.where(
			and(
				eq(session.id, login.sessionId),
				eq(session.userId, login.userId),
				gt(session.expiresAt, new Date())
			)
		)
		.get();
	if (!activeSession) error(401, 'Sign in to Facmandu again');
	await requireServer(login.userId, login.serverId);
	const destination = `/servers/${encodeURIComponent(login.serverId)}?tab=saves`;
	if (event.url.searchParams.get('error')) {
		await db.delete(dropboxLogin).where(eq(dropboxLogin.id, login.id));
		redirect(303, `${destination}&dropbox=cancelled`);
	}
	const code = event.url.searchParams.get('code');
	if (!code) error(400, 'Dropbox did not return an authorization code');
	const token = await exchangeToken({
		grant_type: 'authorization_code',
		code,
		code_verifier: login.verifier,
		redirect_uri: callbackUrl(event)
	});
	if (
		!token.refresh_token ||
		!token.account_id ||
		!scopes.split(' ').every((scope) => token.scope?.split(' ').includes(scope))
	)
		error(400, 'Dropbox did not grant the required backup permissions');
	const credentials = {
		userId: login.userId,
		accountId: token.account_id,
		refreshToken: token.refresh_token
	};
	const sessionToken = generateSessionToken();
	const renewedSession = {
		id: digest(sessionToken),
		userId: login.userId,
		expiresAt: new Date(Date.now() + 30 * 86_400_000)
	};
	// Logout, disconnect, or another linking attempt cancels this pending exchange.
	await db.transaction(
		async (tx) => {
			const pending = await tx
				.select({ id: dropboxLogin.id })
				.from(dropboxLogin)
				.innerJoin(session, eq(session.id, dropboxLogin.sessionId))
				.where(and(eq(dropboxLogin.id, login.id), gt(session.expiresAt, new Date())))
				.get();
			if (!pending) error(401, 'Dropbox connection was cancelled. Start again from Saves.');
			await tx
				.insert(dropboxAccount)
				.values(credentials)
				.onConflictDoUpdate({ target: dropboxAccount.userId, set: credentials });
			await tx.delete(dropboxLogin).where(eq(dropboxLogin.id, login.id));
			// Renew the original sign-in without needing its cross-site-withheld cookie.
			await tx.insert(session).values(renewedSession);
			await tx.delete(session).where(eq(session.id, login.sessionId));
		},
		{ behavior: 'immediate' }
	);
	setSessionTokenCookie(event, sessionToken, renewedSession.expiresAt);
	// A 200 document ends the cross-site redirect chain before using the Strict cookie.
	await updateServerConfig(await requireServer(login.userId, login.serverId), {
		cloudBackup: { enabled: true, ownerId: login.userId }
	});
	const target = `${destination}&amp;dropbox=connected`;
	return new Response(
		`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=${target}"><title>Dropbox connected</title></head><body><p>Dropbox connected. <a href="${target}">Return to Saves</a></p></body></html>`,
		{ headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } }
	);
}
export async function hasDropbox(userId: string) {
	return !!(await db
		.select({ id: dropboxAccount.userId })
		.from(dropboxAccount)
		.where(eq(dropboxAccount.userId, userId))
		.get());
}
export async function dropboxAccess(userId: string) {
	const account = await db
		.select()
		.from(dropboxAccount)
		.where(eq(dropboxAccount.userId, userId))
		.get();
	if (!account) throw new ServerError(409, 'Connect Dropbox first');
	const token = await exchangeToken({
		grant_type: 'refresh_token',
		refresh_token: account.refreshToken
	});
	const current = await db
		.select()
		.from(dropboxAccount)
		.where(eq(dropboxAccount.userId, userId))
		.get();
	if (current?.refreshToken !== account.refreshToken)
		throw new ServerError(409, 'Dropbox connection changed. Try again.');
	return token.access_token;
}
export function dropboxRequest(access: string, endpoint: string, body: unknown) {
	return fetch(`https://api.dropboxapi.com/2/${endpoint}`, {
		method: 'POST',
		headers: { Authorization: `Bearer ${access}`, 'Content-Type': 'application/json' },
		body: JSON.stringify(body),
		signal: AbortSignal.timeout(30_000)
	});
}
export async function requireDropboxResponse(response: Response) {
	if (response.ok) return;
	const problem = z
		.object({ error_summary: z.string().max(1024) })
		.safeParse(await response.json().catch(() => null));
	if (problem.success && problem.data.error_summary.includes('insufficient_space'))
		throw new ServerError(409, 'Dropbox storage is full. The local snapshot was kept.');
	throw new ServerError(
		response.status === 401 ? 401 : response.status === 409 ? 409 : 502,
		response.status === 401
			? 'Dropbox access was revoked. Reconnect Dropbox.'
			: response.status === 409
				? 'The Dropbox save changed or conflicts with an existing file. Refresh and try again; no save was replaced.'
				: response.status === 429
					? 'Dropbox is rate limited. Try again later.'
					: 'Dropbox could not complete the transfer. Existing saves were preserved.'
	);
}
export async function disconnectDropbox(userId: string) {
	await db.delete(dropboxLogin).where(eq(dropboxLogin.userId, userId));
	const access = await dropboxAccess(userId).catch(() => null);
	if (access) {
		const response = await dropboxRequest(access, 'auth/token/revoke', null);
		if (response.status !== 401) await requireDropboxResponse(response);
	}
	await db.delete(dropboxAccount).where(eq(dropboxAccount.userId, userId));
}
