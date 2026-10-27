import type { Handle } from '@sveltejs/kit/hooks';
import * as auth from '#lib/server/auth.js';
import { initializeDatabase } from '#lib/server/db/index.js';
import { startDropboxBackups } from '#lib/server/dropbox-backups.js';
import { startFactoryWatchSampler } from '#lib/server/factory-watches.js';
import { startInGameAssistants } from '#lib/server/in-game-assistant.js';
import { startInGameLayouts } from '#lib/server/in-game-layout.js';
import { building } from '$app/env';

// The hook module loads with the web process, including before its first request.
if (!building)
	void initializeDatabase()
		.then(() => {
			startFactoryWatchSampler();
			startDropboxBackups();
			startInGameAssistants();
			startInGameLayouts();
		})
		.catch((cause) => console.error('Factory watch startup failed:', cause));

const handleAuth: Handle = async ({ event, resolve }) => {
	const sessionToken = event.cookies.get(auth.sessionCookieName);

	if (!sessionToken) {
		event.locals.user = null;
		event.locals.session = null;
		return resolve(event);
	}

	const { session, user } = await auth.validateSessionToken(sessionToken);

	if (session) {
		auth.setSessionTokenCookie(event, sessionToken, session.expiresAt);
	} else {
		auth.deleteSessionTokenCookie(event);
	}

	event.locals.user = user;
	event.locals.session = session;
	return resolve(event);
};

const handleSecurity: Handle = async ({ event, resolve }) => {
	const response = await resolve(event);

	// Add security headers
	response.headers.set('X-Content-Type-Options', 'nosniff');
	response.headers.set('X-Frame-Options', 'DENY');
	response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
	response.headers.set('Permissions-Policy', 'camera=(), microphone=(self), geolocation=()');

	// HSTS for HTTPS
	if (event.url.protocol === 'https:') {
		response.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
	}

	return response;
};

export const handle: Handle = async ({ event, resolve }) => {
	await initializeDatabase();
	startFactoryWatchSampler();
	startDropboxBackups();
	startInGameAssistants();
	startInGameLayouts();
	// Chain the handlers
	return handleSecurity({ event, resolve: async (event) => handleAuth({ event, resolve }) });
};
