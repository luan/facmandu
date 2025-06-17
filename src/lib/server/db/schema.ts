import { encodeBase32LowerCase } from '@oslojs/encoding';
import { sqliteTable, integer, text, unique } from 'drizzle-orm/sqlite-core';

export const user = sqliteTable('user', {
	id: text('id').primaryKey(),
	age: integer('age'),
	username: text('username').notNull().unique(),
	passwordHash: text('password_hash').notNull()
});

export type User = typeof user.$inferSelect;

export const session = sqliteTable('session', {
	id: text('id').primaryKey(),
	userId: text('user_id')
		.notNull()
		.references(() => user.id, { onDelete: 'cascade' }),
	expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull()
});

export type Session = typeof session.$inferSelect;

export const modList = sqliteTable('modlist', {
	id: text('id').primaryKey(),
	owner: text('user_id')
		.notNull()
		.references(() => user.id, { onDelete: 'cascade' }),
	name: text('name').notNull()
});

export type ModList = typeof modList.$inferSelect;

export const mod = sqliteTable(
	'mod',
	{
		id: text('id').primaryKey(),
		modlist: text('modlist_id')
			.notNull()
			.references(() => modList.id, { onDelete: 'cascade' }),
		name: text('name').notNull(),
		enabled: integer('enabled', { mode: 'boolean' })
	},
	(t) => [unique().on(t.modlist, t.name)]
);

export type Mod = typeof mod.$inferSelect;
