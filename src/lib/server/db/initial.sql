-- Generated from schema.ts with drizzle-kit export; used only for a new database.
CREATE TABLE IF NOT EXISTS `mod` (
	`id` text PRIMARY KEY NOT NULL,
	`modlist_id` text NOT NULL,
	`name` text NOT NULL,
	`enabled` integer DEFAULT false,
	`icebox` integer DEFAULT false,
	`essential` integer DEFAULT false,
	`auto_dependency` integer DEFAULT false NOT NULL,
	`title` text,
	`summary` text,
	`description` text,
	`category` text,
	`tags` text,
	`thumbnail` text,
	`downloads_count` integer,
	`last_updated` integer,
	`version` text,
	`factorio_version` text,
	`dependencies` text,
	`last_fetched` integer,
	`fetch_error` text,
	`updated_by` text,
	FOREIGN KEY (`modlist_id`) REFERENCES `modlist`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`updated_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);

CREATE INDEX IF NOT EXISTS `idx_mod_modlist` ON `mod` (`modlist_id`);
CREATE INDEX IF NOT EXISTS `idx_mod_enabled` ON `mod` (`enabled`);
CREATE INDEX IF NOT EXISTS `idx_mod_icebox` ON `mod` (`icebox`);
CREATE INDEX IF NOT EXISTS `idx_mod_last_fetched` ON `mod` (`last_fetched`);
CREATE INDEX IF NOT EXISTS `idx_mod_modlist_enabled` ON `mod` (`modlist_id`,`enabled`);
CREATE INDEX IF NOT EXISTS `idx_mod_modlist_icebox` ON `mod` (`modlist_id`,`icebox`);
CREATE UNIQUE INDEX IF NOT EXISTS `mod_modlist_id_name_unique` ON `mod` (`modlist_id`,`name`);
CREATE TABLE IF NOT EXISTS `modlist` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`factorio_version` text DEFAULT '2.0' NOT NULL,
	`public_read` integer,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);

CREATE INDEX IF NOT EXISTS `idx_modlist_owner` ON `modlist` (`user_id`);
CREATE TABLE IF NOT EXISTS `modlist_collaborator` (
	`modlist_id` text NOT NULL,
	`user_id` text NOT NULL,
	FOREIGN KEY (`modlist_id`) REFERENCES `modlist`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);

CREATE INDEX IF NOT EXISTS `idx_modlist_collaborator_user` ON `modlist_collaborator` (`user_id`);
CREATE INDEX IF NOT EXISTS `idx_modlist_collaborator_modlist` ON `modlist_collaborator` (`modlist_id`);
CREATE UNIQUE INDEX IF NOT EXISTS `modlist_collaborator_modlist_id_user_id_unique` ON `modlist_collaborator` (`modlist_id`,`user_id`);
CREATE TABLE IF NOT EXISTS `portal_cache` (
	`key` text PRIMARY KEY NOT NULL,
	`body` text,
	`status` integer NOT NULL,
	`fetched_at` integer NOT NULL,
	`retry_after` integer DEFAULT 0 NOT NULL,
	`etag` text,
	`last_modified` text
);

CREATE TABLE IF NOT EXISTS `session` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);

CREATE INDEX IF NOT EXISTS `idx_session_user_id` ON `session` (`user_id`);
CREATE INDEX IF NOT EXISTS `idx_session_expires_at` ON `session` (`expires_at`);
CREATE TABLE IF NOT EXISTS `user` (
	`id` text PRIMARY KEY NOT NULL,
	`age` integer,
	`username` text NOT NULL,
	`password_hash` text NOT NULL,
	`factorio_username` text,
	`factorio_token` text,
	`factorio_token_updated_at` integer
);

CREATE UNIQUE INDEX IF NOT EXISTS `user_username_unique` ON `user` (`username`);

CREATE TABLE IF NOT EXISTS native_server (
 id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, directory TEXT NOT NULL UNIQUE,
 game_port INTEGER NOT NULL UNIQUE, rcon_port INTEGER NOT NULL UNIQUE,
 selected_modlist TEXT REFERENCES modlist(id) ON DELETE SET NULL);
CREATE TABLE IF NOT EXISTS native_server_job (
 server_id TEXT PRIMARY KEY NOT NULL REFERENCES native_server(id) ON DELETE CASCADE, body TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS native_server_provision_job (
 server_id TEXT PRIMARY KEY NOT NULL REFERENCES native_server(id) ON DELETE CASCADE, body TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS `server_assistant_turn` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`server_id` text NOT NULL,
	`prompt` text NOT NULL,
	`answer` text DEFAULT '' NOT NULL,
	`state` text NOT NULL,
	`results` text DEFAULT '[]' NOT NULL,
	`receipt` text,
	`model` text,
	`effort` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`server_id`) REFERENCES `native_server`(`id`) ON UPDATE no action ON DELETE cascade
);
CREATE INDEX IF NOT EXISTS `server_assistant_turn_owner` ON `server_assistant_turn` (`user_id`,`server_id`,`created_at`);

CREATE TABLE IF NOT EXISTS recommendation_feedback (
 user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
 list_id TEXT NOT NULL REFERENCES modlist(id) ON DELETE CASCADE,
 mod_name TEXT NOT NULL, PRIMARY KEY(user_id,list_id,mod_name));
