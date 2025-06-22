import { eq } from 'drizzle-orm';
import { fail } from '@sveltejs/kit';
import { getRequestEvent } from '$app/server';
import type { Actions, PageServerLoad } from './$types';
import { superValidate } from 'sveltekit-superforms';
import { zod } from 'sveltekit-superforms/adapters';

import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { schema } from './schema';

export const load: PageServerLoad = async (_event) => {
	void _event;
	const user = requireLogin();

	// Get current user data including Factorio credentials
	const currentUser = await db.select().from(table.user).where(eq(table.user.id, user.id)).get();

	return {
		user: currentUser || null,
		form: await superValidate(zod(schema))
	};
};

export const actions: Actions = {
	updateFactorioCredentials: async (event) => {
		const form = await superValidate(event, zod(schema));
		if (!form.valid) {
			return fail(400, { form });
		}

		const user = requireLogin();
		const { factorioUsername, factorioPassword } = form.data;

		try {
			// Call Factorio API to get token
			const response = await fetch('https://auth.factorio.com/api-login', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/x-www-form-urlencoded'
				},
				body: new URLSearchParams({
					username: factorioUsername,
					password: factorioPassword
				})
			});

			if (!response.ok) {
				return fail(400, {
					form: {
						...form,
						message: 'Invalid Factorio credentials. Please check your username and password.'
					}
				});
			}

			const token = await response.json();

			if (!Array.isArray(token) || token.length === 0) {
				return fail(400, {
					form: {
						...form,
						message: 'Invalid response from Factorio API'
					}
				});
			}

			// Update user with Factorio credentials
			await db
				.update(table.user)
				.set({
					factorioUsername: factorioUsername,
					factorioToken: token[0],
					factorioTokenUpdatedAt: new Date()
				})
				.where(eq(table.user.id, user.id));

			return {
				form: {
					...form,
					message: 'Factorio credentials updated successfully!'
				}
			};
		} catch (err) {
			console.error('Update Factorio credentials error:', err);
			return fail(500, {
				form: {
					...form,
					message: 'Failed to update Factorio credentials. Please try again.'
				}
			});
		}
	}
};

function requireLogin() {
	const { locals } = getRequestEvent();

	if (!locals.user) {
		throw new Error('User not authenticated');
	}

	return locals.user;
}
