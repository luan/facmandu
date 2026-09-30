import { hash } from '@node-rs/argon2';
import { fail, redirect } from '@sveltejs/kit';
import { AccountError, createInvitedAccount } from '$lib/server/accounts';
import * as auth from '$lib/server/auth';
import { genID } from '$lib/server/db/ids';
import type { Actions, PageServerLoad } from './$types';
import { registerSchema } from './schema';

export const load: PageServerLoad = ({ locals }) => {
	if (locals.user) redirect(303, '/');
};

export const actions: Actions = {
	default: async (event) => {
		const input = Object.fromEntries(await auth.authenticationForm(event.request));
		const parsed = registerSchema.safeParse(input);
		const username = typeof input.username === 'string' ? input.username.slice(0, 31) : '';
		if (!parsed.success)
			return fail(400, {
				username,
				message: parsed.error.issues[0]?.message ?? 'Invalid account details'
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
			const passwordHash = await hash(parsed.data.password, {
				memoryCost: 19456,
				timeCost: 2,
				outputLen: 32,
				parallelism: 1
			});
			let user: { id: string };
			try {
				user = await createInvitedAccount(
					{ id: genID('user'), username: parsed.data.username, passwordHash },
					parsed.data.invite
				);
			} catch (cause) {
				if (cause instanceof AccountError) return fail(400, { username, message: cause.message });
				throw cause;
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
