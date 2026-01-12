import { hash } from '@node-rs/argon2';
import { fail, redirect } from '@sveltejs/kit';
import * as auth from '$lib/server/auth';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import type { Actions, PageServerLoad } from './$types';
import { superValidate } from 'sveltekit-superforms';
import { zod as zod4 } from 'sveltekit-superforms/adapters';
import { registerSchema } from './schema';
import { genID } from '$lib/server/db/ids';

export const load: PageServerLoad = async (event) => {
	if (event.locals.user) {
		return redirect(302, '/');
	}
	return {
		form: await superValidate(zod4(registerSchema as any))
	};
};

export const actions: Actions = {
	default: async (event) => {
		const form = await superValidate(event, zod4(registerSchema as any));
		if (!form.valid) {
			return fail(400, {
				form
			});
		}
		const username = (form.data as any).username as string;
		const password = (form.data as any).password as string;

		const userId = genID('user');
		const passwordHash = await hash(password as string | Uint8Array, {
			// recommended minimum parameters
			memoryCost: 19456,
			timeCost: 2,
			outputLen: 32,
			parallelism: 1
		});

		try {
			await db
				.insert(table.user)
				.values({ id: userId, username: username as string, passwordHash: passwordHash as string });

			const sessionToken = auth.generateSessionToken();
			const session = await auth.createSession(sessionToken, userId);
			auth.setSessionTokenCookie(event, sessionToken, session.expiresAt);
		} catch (error) {
			console.error('Register error:', error);
			return fail(500, { message: 'An error has occurred' });
		}

		const redirectTo = event.url.searchParams.get('redirectTo');
		return redirect(302, redirectTo || '/');
	}
};
