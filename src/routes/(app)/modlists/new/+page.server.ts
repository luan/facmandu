import { fail, redirect } from '@sveltejs/kit';
import { z } from 'zod';
import { compareVersions } from '$lib/dependencies';
import { db } from '$lib/server/db';
import { genID } from '$lib/server/db/ids';
import * as table from '$lib/server/db/schema';
import { validModName } from '$lib/server/mod-names';
import { startModlistRepair } from '$lib/server/modlist-repair';
import type { Actions } from './$types';
import { formSchema } from './schema';

const modlistJsonSchema = z.object({
	// Bound a single import; increase only when a real list exceeds this limit.
	mods: z
		.array(
			z.object({
				name: z.string().refine(validModName),
				enabled: z.boolean(),
				version: z
					.string()
					.refine((value) => compareVersions(value, value) !== null)
					.optional()
			})
		)
		.max(5000)
});
export const actions: Actions = {
	default: async ({ request, locals }) => {
		if (!locals.user) return fail(401, { message: 'Sign in to create a mod list' });
		const parsed = formSchema.safeParse(Object.fromEntries(await request.formData()));
		if (!parsed.success)
			return fail(400, { message: parsed.error.issues[0]?.message ?? 'Invalid mod list' });
		const values = parsed.data;
		let imported: unknown;
		try {
			imported = values.json.trim() ? JSON.parse(values.json) : { mods: [] };
		} catch {
			return fail(400, { ...values, message: 'The import is not valid JSON' });
		}
		const result = modlistJsonSchema.safeParse(imported);
		if (!result.success)
			return fail(400, {
				...values,
				message:
					'Use a Factorio mod-list.json containing mods with a name, enabled flag, and optional version'
			});
		const mods = result.data.mods.filter((mod) => mod.name !== 'base');
		if (new Set(mods.map((mod) => mod.name)).size !== mods.length)
			return fail(400, { ...values, message: 'The import contains duplicate mods' });
		const listId = genID('modlist');
		const userId = locals.user.id;
		await db.transaction(async (tx) => {
			await tx.insert(table.modList).values({
				id: listId,
				name: values.name,
				factorioVersion: values.factorioVersion,
				owner: userId
			});
			// Stay below SQLite's parameter limit for large imports.
			for (let offset = 0; offset < mods.length; offset += 100) {
				await tx
					.insert(table.mod)
					.values(
						mods
							.slice(offset, offset + 100)
							.map((mod) => ({ id: genID('mod'), modlist: listId, ...mod }))
					);
			}
		});
		startModlistRepair(listId, userId, { changed: true });
		redirect(303, `/modlists/${listId}`);
	}
};
