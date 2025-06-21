import { encodeBase32LowerCase } from '@oslojs/encoding';
import { sqliteTable, integer, text, unique } from 'drizzle-orm/sqlite-core';

export const user = sqliteTable('user', {
	id: text('id').primaryKey(),
	age: integer('age'),
	username: text('username').notNull().unique(),
	passwordHash: text('password_hash').notNull(),
	factorioUsername: text('factorio_username'),
	factorioToken: text('factorio_token'),
	factorioTokenUpdatedAt: integer('factorio_token_updated_at', { mode: 'timestamp' })
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

export const modListCollaborator = sqliteTable(
	'modlist_collaborator',
	{
		modlistId: text('modlist_id')
			.notNull()
			.references(() => modList.id, { onDelete: 'cascade' }),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' })
	},
	(t) => [unique().on(t.modlistId, t.userId)]
);

export type ModListCollaborator = typeof modListCollaborator.$inferSelect;

export const mod = sqliteTable(
	'mod',
	{
		id: text('id').primaryKey(),
		modlist: text('modlist_id')
			.notNull()
			.references(() => modList.id, { onDelete: 'cascade' }),
		name: text('name').notNull(),
		enabled: integer('enabled', { mode: 'boolean' }),
		// Indicates that this mod is non-negotiable / locked in for the modlist
		essential: integer('essential', { mode: 'boolean' }),
		// Cached mod portal data
		title: text('title'),
		summary: text('summary'),
		description: text('description'),
		category: text('category'),
		tags: text('tags'), // JSON array stored as text
		thumbnail: text('thumbnail'),
		downloadsCount: integer('downloads_count'),
		lastUpdated: integer('last_updated', { mode: 'timestamp' }),
		version: text('version'),
		factorioVersion: text('factorio_version'),
		dependencies: text('dependencies'),
		// Cache metadata
		lastFetched: integer('last_fetched', { mode: 'timestamp' }),
		fetchError: text('fetch_error'),
		updatedBy: text('updated_by').references(() => user.id)
	},
	(t) => [unique().on(t.modlist, t.name)]
);

export type Mod = typeof mod.$inferSelect;
