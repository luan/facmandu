import { fail } from '@sveltejs/kit';
import { sql } from 'drizzle-orm';
import { issueInvite, requireAdmin } from '$lib/server/accounts';
import { authenticationForm } from '$lib/server/auth';
import { db } from '$lib/server/db';
import { invite, user } from '$lib/server/db/schema';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	requireAdmin(locals.user);
	const [users, invites] = await Promise.all([
		db
			.select({ id: user.id, username: user.username, isAdmin: user.isAdmin })
			.from(user)
			.orderBy(user.username),
		db.select().from(invite).orderBy(sql`${invite.createdAt} DESC`).limit(100)
	]);
	return { users, invites };
};
export const actions: Actions = {
	invite: async ({ locals }) => ({ code: await issueInvite(requireAdmin(locals.user).id) }),
	revoke: async ({ locals, request }) => {
		const admin = requireAdmin(locals.user);
		const form = await authenticationForm(request);
		await db.run(
			sql`UPDATE invite SET revoked = 1 WHERE hash = ${String(form.get('id'))} AND used_by IS NULL AND EXISTS (SELECT 1 FROM user WHERE id = ${admin.id} AND is_admin = 1)`
		);
		return { message: 'Invitation revoked' };
	},
	role: async ({ locals, request }) => {
		const admin = requireAdmin(locals.user);
		const form = await authenticationForm(request);
		const id = String(form.get('id'));
		const enabled = form.get('admin') === 'true';
		// This single statement protects the last administrator even under concurrent requests.
		const result = await db.run(sql`UPDATE user SET is_admin = ${enabled ? 1 : 0} WHERE id = ${id}
   AND EXISTS (SELECT 1 FROM user WHERE id = ${admin.id} AND is_admin = 1)
   AND (${enabled ? 1 : 0} = 1 OR is_admin = 0 OR (SELECT count(*) FROM user WHERE is_admin = 1) > 1)`);
		if (!result.rowsAffected)
			return fail(409, {
				message: 'Keep at least one administrator. Refresh if your access has changed.'
			});
		return { message: 'Role updated' };
	}
};
