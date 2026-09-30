import { sql } from 'drizzle-orm';
import {
	index,
	integer,
	primaryKey,
	sqliteTable,
	text,
	unique,
	uniqueIndex
} from 'drizzle-orm/sqlite-core';

export const user = sqliteTable('user', {
	id: text('id').primaryKey(),
	age: integer('age'),
	username: text('username').notNull().unique(),
	passwordHash: text('password_hash').notNull(),
	isAdmin: integer('is_admin', { mode: 'boolean' }).notNull().default(false),
	typesafeApiKey: text('typesafe_api_key'),
	codexSubject: text('codex_subject').unique(),
	codexCredentials: text('codex_credentials'),
	metaSubject: text('meta_subject').unique(),
	metaCredentials: text('meta_credentials'),
	copilotSubject: text('copilot_subject').unique(),
	copilotCredentials: text('copilot_credentials'),
	agentModel: text('agent_model').notNull().default('gpt-5.4'),
	factorioUsername: text('factorio_username'),
	factorioToken: text('factorio_token'),
	factorioTokenUpdatedAt: integer('factorio_token_updated_at', { mode: 'timestamp' })
});

export type User = typeof user.$inferSelect;

export const session = sqliteTable(
	'session',
	{
		id: text('id').primaryKey(),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull()
	},
	(table) => [
		index('idx_session_user_id').on(table.userId),
		index('idx_session_expires_at').on(table.expiresAt)
	]
);

export type Session = typeof session.$inferSelect;

export const modList = sqliteTable(
	'modlist',
	{
		id: text('id').primaryKey(),
		owner: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		name: text('name').notNull(),
		factorioVersion: text('factorio_version').notNull().default('2.0'),
		publicRead: integer('public_read', { mode: 'boolean' })
	},
	(table) => [index('idx_modlist_owner').on(table.owner)]
);

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
	(t) => [
		unique().on(t.modlistId, t.userId),
		index('idx_modlist_collaborator_user').on(t.userId),
		index('idx_modlist_collaborator_modlist').on(t.modlistId)
	]
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
		enabled: integer('enabled', { mode: 'boolean' }).default(false),
		// Indicates a mod is in the icebox (triage) list and not yet enabled/disabled
		icebox: integer('icebox', { mode: 'boolean' }).default(false),
		// Indicates that this mod is non-negotiable / locked in for the modlist
		essential: integer('essential', { mode: 'boolean' }).default(false),
		autoDependency: integer('auto_dependency', { mode: 'boolean' }).notNull().default(false),
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
	(t) => [
		unique().on(t.modlist, t.name),
		index('idx_mod_modlist').on(t.modlist),
		index('idx_mod_enabled').on(t.enabled),
		index('idx_mod_icebox').on(t.icebox),
		index('idx_mod_last_fetched').on(t.lastFetched),
		index('idx_mod_modlist_enabled').on(t.modlist, t.enabled),
		index('idx_mod_modlist_icebox').on(t.modlist, t.icebox)
	]
);

export type Mod = typeof mod.$inferSelect;
export type ModSummary = Omit<Mod, 'description' | 'tags'>;

export const managedServer = sqliteTable('native_server', {
	id: text('id').primaryKey(),
	name: text('name').notNull(),
	directory: text('directory').notNull().unique(),
	gamePort: integer('game_port').notNull().unique(),
	rconPort: integer('rcon_port').notNull().unique(),
	selectedModlist: text('selected_modlist').references(() => modList.id, { onDelete: 'set null' })
});

export type ManagedServer = typeof managedServer.$inferSelect;

export const factoryWatch = sqliteTable(
	'factory_watch',
	{
		id: text('id').primaryKey(),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		serverId: text('server_id')
			.notNull()
			.references(() => managedServer.id, { onDelete: 'cascade' }),
		kind: text('kind', { enum: ['research_stalled', 'item_deficit'] }).notNull(),
		force: text('force').notNull(),
		surface: text('surface'),
		item: text('item'),
		enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
		validated: integer('validated', { mode: 'boolean' }).notNull().default(false),
		validationError: text('validation_error'),
		createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
		lastSampledAt: integer('last_sampled_at', { mode: 'timestamp_ms' }),
		lastChangedAt: integer('last_changed_at', { mode: 'timestamp_ms' }),
		lastResearch: text('last_research'),
		lastProgress: integer('last_progress'),
		alerting: integer('alerting', { mode: 'boolean' }).notNull().default(false)
	},
	(table) => [
		index('factory_watch_owner').on(table.userId, table.serverId),
		uniqueIndex('factory_watch_identity').on(
			table.userId,
			table.serverId,
			table.kind,
			table.force,
			sql`coalesce(${table.surface}, '')`,
			sql`coalesce(${table.item}, '')`
		)
	]
);
export type FactoryWatch = typeof factoryWatch.$inferSelect;

export const factoryWatchEvent = sqliteTable(
	'factory_watch_event',
	{
		id: text('id').primaryKey(),
		watchId: text('watch_id').references(() => factoryWatch.id, { onDelete: 'set null' }),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		serverId: text('server_id')
			.notNull()
			.references(() => managedServer.id, { onDelete: 'cascade' }),
		message: text('message').notNull(),
		createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
		readAt: integer('read_at', { mode: 'timestamp_ms' })
	},
	(table) => [index('factory_watch_event_owner').on(table.userId, table.createdAt)]
);
export type FactoryWatchEvent = typeof factoryWatchEvent.$inferSelect;

export const portalCache = sqliteTable('portal_cache', {
	key: text('key').primaryKey(),
	body: text('body'),
	status: integer('status').notNull(),
	fetchedAt: integer('fetched_at').notNull(),
	retryAfter: integer('retry_after').notNull().default(0),
	etag: text('etag'),
	lastModified: text('last_modified')
});

export const serverJob = sqliteTable('native_server_job', {
	serverId: text('server_id')
		.primaryKey()
		.references(() => managedServer.id, { onDelete: 'cascade' }),
	body: text('body').notNull()
});

export const serverProvisionJob = sqliteTable('native_server_provision_job', {
	serverId: text('server_id')
		.primaryKey()
		.references(() => managedServer.id, { onDelete: 'cascade' }),
	body: text('body').notNull()
});

export const invite = sqliteTable('invite', {
	hash: text('hash').primaryKey(),
	createdBy: text('created_by')
		.notNull()
		.references(() => user.id),
	createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
	expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
	usedBy: text('used_by').references(() => user.id),
	revoked: integer('revoked', { mode: 'boolean' }).notNull().default(false)
});

export const modlistPlan = sqliteTable('modlist_plan', {
	chatId: text('chat_id').references(() => assistantChat.id, { onDelete: 'cascade' }),
	id: text('id').primaryKey(),
	userId: text('user_id')
		.notNull()
		.references(() => user.id, { onDelete: 'cascade' }),
	listId: text('list_id')
		.notNull()
		.references(() => modList.id, { onDelete: 'cascade' }),
	snapshot: text('snapshot').notNull(),
	body: text('body').notNull(),
	createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
	applied: integer('applied', { mode: 'boolean' }).notNull().default(false)
});
export const assistantTurn = sqliteTable('assistant_turn', {
	chatId: text('chat_id').references(() => assistantChat.id, { onDelete: 'cascade' }),
	effort: text('effort'),
	mods: text('mods').notNull().default('[]'),
	results: text('results').notNull().default('[]'),
	receipt: text('receipt'),
	model: text('model'),
	id: text('id').primaryKey(),
	userId: text('user_id')
		.notNull()
		.references(() => user.id, { onDelete: 'cascade' }),
	listId: text('list_id')
		.notNull()
		.references(() => modList.id, { onDelete: 'cascade' }),
	prompt: text('prompt').notNull(),
	answer: text('answer').notNull().default(''),
	state: text('state', { enum: ['running', 'done', 'error'] }).notNull(),
	createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull()
});

export const serverAssistantTurn = sqliteTable(
	'server_assistant_turn',
	{
		chatId: text('chat_id').references(() => assistantChat.id, { onDelete: 'cascade' }),
		id: text('id').primaryKey(),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		serverId: text('server_id')
			.notNull()
			.references(() => managedServer.id, { onDelete: 'cascade' }),
		prompt: text('prompt').notNull(),
		answer: text('answer').notNull().default(''),
		state: text('state', { enum: ['running', 'done', 'error'] }).notNull(),
		results: text('results').notNull().default('[]'),
		receipt: text('receipt'),
		model: text('model'),
		effort: text('effort'),
		createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull()
	},
	(table) => [
		index('server_assistant_turn_owner').on(table.userId, table.serverId, table.createdAt)
	]
);

export const recommendationFeedback = sqliteTable(
	'recommendation_feedback',
	{
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		listId: text('list_id')
			.notNull()
			.references(() => modList.id, { onDelete: 'cascade' }),
		modName: text('mod_name').notNull()
	},
	(table) => [primaryKey({ columns: [table.userId, table.listId, table.modName] })]
);

export const assistantChat = sqliteTable('assistant_chat', {
	id: text('id').primaryKey(),
	userId: text('user_id')
		.notNull()
		.references(() => user.id, { onDelete: 'cascade' }),
	listId: text('list_id').references(() => modList.id, { onDelete: 'cascade' }),
	serverId: text('server_id').references(() => managedServer.id, { onDelete: 'cascade' }),
	title: text('title').notNull().default('New chat'),
	createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
	updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
	compactedAt: integer('compacted_at', { mode: 'timestamp_ms' })
});
