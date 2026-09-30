import { sha256 } from '@oslojs/crypto/sha2';
import { encodeBase64url, encodeHexLowerCase } from '@oslojs/encoding';
import { error, type RequestEvent } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { env } from '$env/dynamic/private';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';

const DAY_IN_MS = 1000 * 60 * 60 * 24;

export const sessionCookieName = 'auth-session';

export async function authenticationForm(request: Request): Promise<FormData> {
	// Save uploads have a large global body allowance; authentication never needs more than 16 KiB.
	const limit = 16 * 1024;
	if (Number(request.headers.get('content-length')) > limit) error(413, 'Form is too large');
	const contentType = request.headers.get('content-type') ?? '';
	if (!/^(application\/x-www-form-urlencoded|multipart\/form-data)(?:;|$)/iu.test(contentType))
		error(415, 'Submit a form');
	const reader = request.body?.getReader();
	if (!reader) error(400, 'Form is empty');
	const chunks: Uint8Array[] = [];
	let size = 0;
	try {
		for (;;) {
			const { value, done } = await reader.read();
			if (done) break;
			size += value.byteLength;
			if (size > limit) {
				// Cancel would destroy adapter-node's connection before it can send the 413 response.
				error(413, 'Form is too large');
			}
			chunks.push(value);
		}
	} finally {
		reader.releaseLock();
	}
	const body = new Uint8Array(size);
	let offset = 0;
	for (const chunk of chunks) {
		body.set(chunk, offset);
		offset += chunk.byteLength;
	}
	try {
		return await new Response(body, { headers: { 'Content-Type': contentType } }).formData();
	} catch {
		error(400, 'Invalid form');
	}
}

const attempts = new Map<string, { count: number; resetAt: number }>();
let activeAuthentications = 0;

export function beginAuthentication(
	address: string
): { allowed: true; release: () => void } | { allowed: false; retryAfter: number } {
	const now = Date.now();
	let window = attempts.get(address);
	if (!window || window.resetAt <= now) {
		if (attempts.size >= 10_000) {
			for (const [key, value] of attempts) if (value.resetAt <= now) attempts.delete(key);
			if (attempts.size >= 10_000) return { allowed: false, retryAfter: 60 };
		}
		window = { count: 0, resetAt: now + 60_000 };
		attempts.set(address, window);
	}
	if (window.count >= 30)
		return { allowed: false, retryAfter: Math.ceil((window.resetAt - now) / 1000) };
	window.count++;
	// Bound Argon2's CPU and memory work. Add shared limits before running multiple app processes.
	if (activeAuthentications >= 2) return { allowed: false, retryAfter: 1 };
	activeAuthentications++;
	return {
		allowed: true,
		release: () => {
			activeAuthentications--;
		}
	};
}

export function safeRedirectTo(value: string | null): string {
	if (!value?.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return '/';
	try {
		return new URL(value, 'http://localhost').origin === 'http://localhost' ? value : '/';
	} catch {
		return '/';
	}
}

export function generateSessionToken() {
	const bytes = crypto.getRandomValues(new Uint8Array(18));
	const token = encodeBase64url(bytes);
	return token;
}

export async function createSession(token: string, userId: string) {
	const sessionId = encodeHexLowerCase(sha256(new TextEncoder().encode(token)));
	const session: table.Session = {
		id: sessionId,
		userId,
		expiresAt: new Date(Date.now() + DAY_IN_MS * 30)
	};
	await db.insert(table.session).values(session);
	return session;
}

export async function validateSessionToken(token: string) {
	const sessionId = encodeHexLowerCase(sha256(new TextEncoder().encode(token)));
	const [result] = await db
		.select({
			// Adjust user table here to tweak returned data
			user: { id: table.user.id, username: table.user.username, isAdmin: table.user.isAdmin },
			session: table.session
		})
		.from(table.session)
		.innerJoin(table.user, eq(table.session.userId, table.user.id))
		.where(eq(table.session.id, sessionId));

	if (!result) {
		return { session: null, user: null };
	}
	const { session, user } = result;

	const sessionExpired = Date.now() >= session.expiresAt.getTime();
	if (sessionExpired) {
		await db.delete(table.session).where(eq(table.session.id, session.id));
		return { session: null, user: null };
	}

	const renewSession = Date.now() >= session.expiresAt.getTime() - DAY_IN_MS * 15;
	if (renewSession) {
		session.expiresAt = new Date(Date.now() + DAY_IN_MS * 30);
		await db
			.update(table.session)
			.set({ expiresAt: session.expiresAt })
			.where(eq(table.session.id, session.id));
	}

	return { session, user };
}

export type SessionValidationResult = Awaited<ReturnType<typeof validateSessionToken>>;

export async function invalidateSession(sessionId: string) {
	await db.delete(table.session).where(eq(table.session.id, sessionId));
}

export function setSessionTokenCookie(event: RequestEvent, token: string, expiresAt: Date) {
	event.cookies.set(sessionCookieName, token, {
		expires: expiresAt,
		path: '/',
		httpOnly: true,
		secure: true,
		sameSite: 'strict'
	});
}

export function deleteSessionTokenCookie(event: RequestEvent) {
	event.cookies.delete(sessionCookieName, {
		path: '/',
		httpOnly: true,
		secure: true,
		sameSite: 'strict'
	});
}

export function requireSameOrigin(request: Request, url: URL) {
	// Vite sees the tunnel's HTTP origin; ORIGIN is the configured public HTTPS origin.
	const origin = env.ORIGIN ? new URL(env.ORIGIN).origin : url.origin;
	if (request.headers.get('origin') !== origin) error(403, 'Invalid request origin');
}
