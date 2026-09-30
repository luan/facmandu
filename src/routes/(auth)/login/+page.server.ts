import { verify } from '@node-rs/argon2';
import { fail, redirect } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import * as auth from '$lib/server/auth';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import type { Actions, PageServerLoad } from './$types';
import { loginSchema } from './schema';

export const load: PageServerLoad = ({ locals }) => {
	if (locals.user) redirect(303, '/');
};

export const actions: Actions = {
	default: async (event) => {
		const input = Object.fromEntries(await auth.authenticationForm(event.request));
		const parsed = loginSchema.safeParse(input);
		const username = typeof input.username === 'string' ? input.username.slice(0, 50) : '';
		if (!parsed.success)
			return fail(400, {
				username,
				message: parsed.error.issues[0]?.message ?? 'Invalid login details'
			});
		const attempt = auth.beginAuthentication(event.getClientAddress());
		if (!attempt.allowed) {
			event.setHeaders({ 'Retry-After': String(attempt.retryAfter) });
			return fail(429, {
				username,
				message: `Too many attempts. Try again in ${attempt.retryAfter} seconds.`
			});
		}
		try {
			const user = await db
				.select()
				.from(table.user)
				.where(eq(table.user.username, parsed.data.username))
				.get();
			if (
				!user?.passwordHash.startsWith('$argon2') ||
				!(await verify(user.passwordHash, parsed.data.password))
			) {
				return fail(400, { username, message: 'Incorrect username or password' });
			}
			const token = auth.generateSessionToken();
			const session = await auth.createSession(token, user.id);
			auth.setSessionTokenCookie(event, token, session.expiresAt);
			redirect(303, auth.safeRedirectTo(event.url.searchParams.get('redirectTo')));
		} finally {
			attempt.release();
		}
	}
};
