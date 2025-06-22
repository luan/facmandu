import { fail, redirect } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { genID } from '$lib/server/db/ids';
import type { Actions, PageServerLoad } from './$types';
import { superValidate } from 'sveltekit-superforms';
import { zod } from 'sveltekit-superforms/adapters';
import { formSchema } from './schema';

export const load: PageServerLoad = async (_event) => {
	void _event;
	return {
		form: await superValidate(zod(formSchema))
	};
};

type ModListJSON = {
	mods: Array<{ name: string; enabled: boolean }>;
};

export const actions: Actions = {
	default: async (event) => {
		if (!event.locals.user) {
			return fail(401, { message: 'Unauthorized' });
		}

		const form = await superValidate(event, zod(formSchema));
		if (!form.valid) {
			return fail(400, {
				form
			});
		}
		const name = form.data.name;
		let modlistJSON: ModListJSON;
		try {
			modlistJSON = JSON.parse(form.data.json);
		} catch {
			return fail(400, { message: 'Invalid JSON' });
		}

		try {
			const userID = event.locals.user.id;
			await db.transaction(async (tx) => {
				const [modlist] = await tx
					.insert(table.modList)
					.values({ id: genID('modlist'), name, owner: userID })
					.returning();
				await tx
					.insert(table.mod)
					.values(
						modlistJSON.mods.map((mod) => ({ id: genID('mod'), modlist: modlist.id, ...mod }))
					);
			});
		} catch (error) {
			console.error('Create modlist error:', error);
			return fail(500, { message: 'An error has occurred' });
		}
		return redirect(302, '/');
	}
};
