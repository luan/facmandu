import { verify } from '@node-rs/argon2';
import { fail, redirect } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import * as auth from '$lib/server/auth';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import type { Actions, PageServerLoad } from './$types';
import { superValidate } from 'sveltekit-superforms';
import { zod } from 'sveltekit-superforms/adapters';
import { loginSchema } from './schema';

export const load: PageServerLoad = async (event) => {
	if (event.locals.user) {
		return redirect(302, '/');
	}
	return {
		form: await superValidate(zod(loginSchema))
	};
};

export const actions: Actions = {
	default: async (event) => {
		const form = await superValidate(event, zod(loginSchema));
		if (!form.valid) {
			return fail(400, {
				form
			});
		}
		const username = form.data.username;
		const password = form.data.password;
		const redirectTo = event.url.searchParams.get('redirectTo');

		const results = await db.select().from(table.user).where(eq(table.user.username, username));

		const existingUser = results.at(0);
		if (!existingUser) {
			return fail(400, { form: { ...form, message: 'Incorrect username or password' } });
		}

		const validPassword = await verify(existingUser.passwordHash, password, {
			memoryCost: 19456,
			timeCost: 2,
			outputLen: 32,
			parallelism: 1
		});
		if (!validPassword) {
			return fail(400, { form: { ...form, message: 'Incorrect username or password' } });
		}

		const sessionToken = auth.generateSessionToken();
		const session = await auth.createSession(sessionToken, existingUser.id);
		auth.setSessionTokenCookie(event, sessionToken, session.expiresAt);

		return redirect(302, redirectTo || '/');
	}
};
