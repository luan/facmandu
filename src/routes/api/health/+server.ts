import { json } from '@sveltejs/kit';
import { sql } from 'drizzle-orm';
import { db } from '#lib/server/db/index.js';
import { FACMANDU_REVISION } from '$app/env/private';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => {
	await db.run(sql`SELECT 1`);
	return json(
		{ status: 'ok', revision: FACMANDU_REVISION ?? 'development' },
		{ headers: { 'Cache-Control': 'no-store' } }
	);
};
