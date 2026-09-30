import { createHash, randomBytes } from 'node:crypto';
import { error } from '@sveltejs/kit';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import { db } from './db';
import { invite, modList, user } from './db/schema';

export class AccountError extends Error {}
export const inviteHash = (code: string) => createHash('sha256').update(code.trim()).digest('hex');

export function requireAdmin(account: App.Locals['user']) {
	if (!account) error(401, 'Sign in to manage accounts');
	if (!account.isAdmin) error(403, 'Administrator access required');
	return account;
}

export async function issueInvite(adminId: string) {
	const code = randomBytes(24).toString('base64url');
	// The issuing role and insert are checked together, including concurrent demotion.
	const result = await db.run(sql`INSERT INTO invite (hash, created_by, created_at, expires_at)
 SELECT ${inviteHash(code)}, id, unixepoch(), unixepoch() + 604800 FROM user
 WHERE id = ${adminId} AND is_admin = 1`);
	if (!result.rowsAffected) error(403, 'Administrator access required');
	return code;
}

export function createInvitedAccount(
	account: Pick<
		typeof user.$inferInsert,
		| 'id'
		| 'username'
		| 'passwordHash'
		| 'codexSubject'
		| 'codexCredentials'
		| 'metaSubject'
		| 'metaCredentials'
		| 'copilotSubject'
		| 'copilotCredentials'
	>,
	code: string
) {
	return db.transaction(
		async (tx) => {
			const invitation = await tx
				.select()
				.from(invite)
				.where(
					and(
						eq(invite.hash, inviteHash(code)),
						isNull(invite.usedBy),
						eq(invite.revoked, false),
						gt(invite.expiresAt, new Date())
					)
				)
				.get();
			if (!invitation)
				throw new AccountError('This invitation is invalid, expired, or already used');
			const created = await tx
				.insert(user)
				.values(account)
				.onConflictDoNothing({ target: user.username })
				.returning({ id: user.id })
				.get();
			if (!created) throw new AccountError('This username is already taken');
			await tx.update(invite).set({ usedBy: created.id }).where(eq(invite.hash, invitation.hash));
			return created;
		},
		{ behavior: 'immediate' }
	);
}

export function listOwnerKey(listId: string) {
	return db
		.select({ ownerId: user.id, apiKey: user.typesafeApiKey })
		.from(modList)
		.innerJoin(user, eq(modList.owner, user.id))
		.where(eq(modList.id, listId))
		.get();
}
