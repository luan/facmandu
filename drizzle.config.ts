import { defineConfig } from 'drizzle-kit';
import { createClient } from '@libsql/client';

const connectionUrl = process.env.TURSO_CONNECTION_URL || process.env.DATABASE_URL;
if (!connectionUrl) throw new Error('TURSO_CONNECTION_URL or DATABASE_URL must be set');

const clientConfig: Parameters<typeof createClient>[0] = { url: connectionUrl };
if (process.env.TURSO_AUTH_TOKEN) {
	clientConfig.authToken = process.env.TURSO_AUTH_TOKEN;
}

export default defineConfig({
	schema: './src/lib/server/db/schema.ts',
	dialect: process.env.DATABASE_URL ? 'sqlite' : 'turso',
	dbCredentials: clientConfig,
	verbose: true,
	strict: true
});
